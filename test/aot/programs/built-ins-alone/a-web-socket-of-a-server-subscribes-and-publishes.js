const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    passed.upgrade(request, { data: { size: 1.5 } });
  },
  websocket: {
    open(socket) {
      socket.subscribe("news");
      console.log(socket.isSubscribed("news"), socket.subscriptions.join(), server.subscriberCount("news") + 1);
      console.log(typeof socket.publish("news", "a"), typeof socket.publishText("news", "b"), typeof socket.publishBinary("news", new Uint8Array([1])));
      console.log(server.publish("news", "from the server") > 0);
    },
    message(socket) {
      socket.unsubscribe("news");
      console.log(socket.isSubscribed("news"));
      socket.close();
    },
    close() {
      resolve();
    },
  },
});
const client = new WebSocket(server.url);
client.onmessage = event => {
  console.log(event.data);
  client.send("thanks");
};
await promise;
await server.stop(true);
