const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    console.log(passed.upgrade(request, { data: { size: 1.5 } }));
  },
  websocket: {
    open(socket) {
      console.log("open", socket.data.size + 1, arguments.length);
    },
    message(socket, message) {
      console.log("message", typeof message, message.length, socket.data.size + 1);
      socket.send(`echo ${message}`);
    },
    close(socket, code, reason) {
      console.log("close", typeof code, typeof reason);
      resolve();
    },
  },
});
const client = new WebSocket(server.url);
client.onopen = () => client.send("hello");
client.onmessage = event => {
  console.log(event.data);
  client.close();
};
await promise;
await server.stop(true);
