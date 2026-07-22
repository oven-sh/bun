// Can a Bun.serve fetch handler normalize a short Sec-WebSocket-Key before upgrading?
import http from "http";
const server = Bun.serve({
  port: 0,
  fetch(req, server) {
    if (req.headers.get("upgrade")) {
      const key = req.headers.get("sec-websocket-key");
      console.log("[server] incoming key:", JSON.stringify(key));
      if (key && key.length !== 24) {
        try {
          req.headers.set("sec-websocket-key", btoa(key.padEnd(16, "\0").slice(0, 16)));
          console.log("[server] rewrote key ->", req.headers.get("sec-websocket-key"));
        } catch (e) {
          console.log("[server] header set failed:", e.message);
        }
      }
      if (server.upgrade(req)) return;
      console.log("[server] upgrade refused");
      return new Response(null, { status: 426 });
    }
    return new Response("ok");
  },
  websocket: { open() { console.log("[server] ws open"); }, message() {} },
});
const req = http.get({
  port: server.port, family: 4, path: "/",
  headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": "AAAAAAAAAAAAAAAAAAAAAA==" },
});
req.on("upgrade", (m, s) => { console.log("[client] UPGRADE", m.statusCode); s.destroy(); process.exit(0); });
req.on("response", r => { console.log("[client] RESPONSE", r.statusCode); process.exit(0); });
setTimeout(() => { console.log("timeout"); process.exit(1); }, 4000);
