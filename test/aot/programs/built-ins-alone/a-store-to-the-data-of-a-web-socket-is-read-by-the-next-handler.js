const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    passed.upgrade(request, { data: 0 });
  },
  websocket: {
    open(socket) {
      socket.data = "text";
    },
    message(socket) {
      console.log(typeof socket.data, socket.data.length);
      socket.close();
    },
    close() {
      resolve();
    },
  },
});
const client = new WebSocket(server.url);
client.onopen = () => client.send("hello");
await promise;
await server.stop(true);
