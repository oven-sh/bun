// See ./README.md for instructions on how to run this benchmark.
const CLIENTS_TO_WAIT_FOR = parseInt(process.env.CLIENTS_COUNT || "", 10) || 32;
var remainingClients = CLIENTS_TO_WAIT_FOR;
const COMPRESS = process.env.COMPRESS === "1";
const port = process.PORT || 4001;

const server = Bun.serve({
  port: port,
  websocket: {
    open(ws) {
      ws.subscribe("room");

      remainingClients--;
      console.log(`${ws.data.name} connected (${remainingClients} remain)`);

      if (remainingClients === 0) {
        console.log("All clients connected");
        setTimeout(() => {
          console.log('Starting benchmark by sending "ready" message');
          ws.publishText("room", `ready`);
        }, 100);
      }
    },
    message(ws, msg) {
      const out = `${ws.data.name}: ${msg}`;
      if (ws.publishText("room", out) !== out.length) {
        throw new Error("Failed to publish message");
      }
    },
    close(ws) {
      remainingClients++;
    },

    perMessageDeflate: false,
    publishToSelf: true,
  },

  fetch(req, server) {
    if (
      server.upgrade(req, {
        data: {
          name: new URL(req.url).searchParams.get("name") || "Client #" + (CLIENTS_TO_WAIT_FOR - remainingClients),
        },
      })
    )
      return;

    return new Response("Error");
  },
});

console.log(`Waiting for ${remainingClients} clients to connect...\n`, `  http://${server.hostname}:${port}/`);
