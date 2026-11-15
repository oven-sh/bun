// As for the channel: MessageEvent and CloseEvent are made by the socket.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    return server.upgrade(request) ? undefined : new Response("no");
  },
  websocket: {
    message(socket, message) {
      socket.send(`${message}!`);
      socket.close(4000, "made up");
    },
  },
});
const said = [];
const socket = new WebSocket(`ws://127.0.0.1:${server.port}/`);
socket.addEventListener("open", event => {
  said.push(`${event.constructor.name} ${event.type}`);
  socket.send("a");
});
socket.addEventListener("message", event => said.push(`${event.constructor.name} ${event.data} ${event instanceof MessageEvent}`));
await new Promise(resolve =>
  socket.addEventListener("close", event => {
    said.push(`${event.constructor.name} ${event.code} ${event.reason} ${event.wasClean}`);
    resolve();
  }),
);
console.log(`${said.join(" | ")}`);
server.stop(true);
