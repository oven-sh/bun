const log = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    const name = new URL(request.url).searchParams.get("name");
    if (server.upgrade(request, { data: { name } })) return;
    return new Response("not a websocket", { status: 426 });
  },
  websocket: {
    open(socket) {
      socket.subscribe("room");
      log.push("open " + socket.data.name);
    },
    message(socket, message) {
      if (typeof message === "string") socket.send(socket.data.name + " said " + message);
      else socket.send(new Uint8Array(message).reverse());
      if (message === "shout") server.publish("room", "everyone hears " + socket.data.name);
    },
    close(socket, code, reason) {
      log.push("close " + socket.data.name + " " + code + " " + reason);
    },
  },
});

console.log((await fetch(server.url)).status);
const client = new WebSocket("ws://127.0.0.1:" + server.port + "/?name=ada");
client.binaryType = "arraybuffer";
const received = [];
const next = () => new Promise(resolve => client.addEventListener("message", event => resolve(event.data), { once: true }));
await new Promise((resolve, reject) => {
  client.onopen = resolve;
  client.onerror = reject;
});
console.log(client.readyState === WebSocket.OPEN, client.protocol === "", server.pendingWebSockets);
client.send("hello");
received.push(await next());
client.send(new Uint8Array([1, 2, 3]));
received.push([...new Uint8Array(await next())]);
client.send("shout");
received.push(await next(), await next());
console.log(received);
const closed = new Promise(resolve => (client.onclose = event => resolve([event.code, event.reason, event.wasClean])));
client.close(4000, "done");
console.log(await closed);
await Bun.sleep(10);
console.log(log);
server.stop(true);
