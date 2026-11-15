const log = [];
const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, server) { return server.upgrade(request, { data: { name: "n" } }) ? undefined : new Response("no", { status: 400 }); },
  websocket: {
    open(socket) { log.push("open", socket.data.name); socket.send("hello"); },
    message(socket, message) { log.push("message", typeof message, String(message)); socket.close(1000, "bye"); },
    close(socket, code, reason) { log.push("close", code, reason); resolve(); },
  },
});
const client = new WebSocket(String(server.url).replace("http", "ws"));
client.onmessage = event => { log.push("client", event.data); client.send("back"); };
await promise;
await server.stop(true);
console.log(log.join());
