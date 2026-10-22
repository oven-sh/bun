const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    passed.upgrade(request, { data: { size: 1.5 } });
  },
  websocket: {
    open(socket) {
      console.log(socket.readyState + 1, typeof socket.remoteAddress, socket.binaryType, socket.getBufferedAmount() + 1, socket.data.size + 1, socket.subscriptions.length, socket.isSubscribed("news"));
      socket.close(1000, "done");
    },
    message() {},
    close() {
      resolve();
    },
  },
});
const client = new WebSocket(server.url);
await promise;
await server.stop(true);
