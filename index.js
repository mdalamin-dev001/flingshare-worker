import { DurableObject } from "cloudflare:workers";

// One Room per 6-digit code. Holds at most 2 sockets (host + guest).
// Hibernation API: no billed duration while idle. No storage = no row reads/writes.
export class Room extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    const peers = this.ctx.getWebSockets();

    if (role === "guest" && peers.length === 0) return new Response("no room", { status: 404 });
    if (role === "host" && peers.length > 0) return new Response("taken", { status: 409 });
    if (peers.length >= 2) return new Response("full", { status: 409 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "hello", role }));
    if (role === "guest") peers.forEach((p) => p.send(JSON.stringify({ type: "peer-joined" })));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    for (const p of this.ctx.getWebSockets()) if (p !== ws) p.send(msg);
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {}
    for (const p of this.ctx.getWebSockets()) {
      if (p !== ws) try { p.send(JSON.stringify({ type: "peer-left" })); } catch {}
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const room = url.searchParams.get("room") || "";
    if (url.pathname !== "/ws" || !/^\d{6}$/.test(room)) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(req);
  },
};
