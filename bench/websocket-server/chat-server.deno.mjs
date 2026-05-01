// See ./README.md for instructions on how to run this benchmark.
const port = Deno.env.get("PORT") || 4001;
const CLIENTS_TO_WAIT_FOR = parseInt(Deno.env.get("CLIENTS_COUNT") || "", 10) || 32;

var clients = [];
async function reqHandler(req) {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 501 });
  }
  const { socket: client, response } = Deno.upgradeWebSocket(req);

  clients.push(client);
  const name = new URL(req.url).searchParams.get("name");

  console.log(`${name} connected (${CLIENTS_TO_WAIT_FOR - clients.length} remain)`);

  client.onmessage = event => {
    const msg = `${name}: ${event.data}`;
    for (let client of clients) {
      client.send(msg);
    }
  };
  client.onclose = () => {
    clients.splice(clients.indexOf(client), 1);
  };

  if (clients.length === CLIENTS_TO_WAIT_FOR) {
    sendReadyMessage();
  }
  return response;
}

function sendReadyMessage() {
  console.log("All clients connected");
  setTimeout(() => {
    console.log("Starting benchmark");
    for (let client of clients) {
      client.send(`ready`);
    }
  }, 100);
}

console.log(`Waiting for ${CLIENTS_TO_WAIT_FOR} clients to connect..`);

Deno.serve({ port }, reqHandler);
