class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const { promise, resolve } = Promise.withResolvers();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: new Item(1.5),
  socket: {
    open(socket) {
      console.log(socket.data.double());
      socket.end();
    },
    data() {},
  },
});
await Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  data: new Item(2.5),
  socket: {
    open(socket) {
      console.log(socket.data.double());
    },
    data() {},
    close() {
      resolve();
    },
  },
});
await promise;
listener.stop(true);
