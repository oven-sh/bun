class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    passed.upgrade(request, { data: new Item(1.5) });
  },
  websocket: {
    open(socket) {
      console.log(socket.data.double());
      socket.close();
    },
    message() {},
    close() {
      resolve();
    },
  },
});
new WebSocket(server.url);
await promise;
await server.stop(true);
