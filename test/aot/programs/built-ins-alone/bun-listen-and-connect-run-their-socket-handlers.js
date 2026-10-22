const { promise, resolve } = Promise.withResolvers();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: { side: 1.5 },
  socket: {
    open(socket) {
      console.log("server open", socket.data.side + 1);
    },
    data(socket, chunk) {
      console.log("server data", chunk instanceof Uint8Array, chunk.toString());
      socket.end("pong");
    },
  },
});
await Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  data: "client",
  socket: {
    open(socket) {
      console.log("client open", socket.data.length);
      socket.write("ping");
    },
    data(socket, chunk) {
      console.log("client data", chunk.toString());
    },
    close() {
      resolve();
    },
  },
});
await promise;
listener.stop(true);
