// bench/websocket-server chat server without publish/subscribe: broadcasts by looping ws.send(), like the node "ws" and Deno servers.
const CLIENTS_TO_WAIT_FOR = parseInt(process.env.CLIENTS_COUNT || "", 10) || 32;
var remainingClients = CLIENTS_TO_WAIT_FOR;
const port = process.env.PORT || 4001;
const clients = new Set();

Bun.serve({
  port,
  websocket: {
    open(ws) {
      clients.add(ws);
      remainingClients--;
      if (remainingClients === 0) {
        setTimeout(() => {
          for (const c of clients) c.send("ready");
        }, 100);
      }
    },
    message(ws, msg) {
      const out = `${ws.data.name}: ${msg}`;
      for (const c of clients) c.send(out);
    },
    close(ws) {
      clients.delete(ws);
      remainingClients++;
    },
    perMessageDeflate: false,
  },
  fetch(req, server) {
    if (server.upgrade(req, { data: { name: new URL(req.url).searchParams.get("name") } })) return;
    return new Response("Error");
  },
});
console.log(`Waiting for ${CLIENTS_TO_WAIT_FOR} clients to connect...`);
