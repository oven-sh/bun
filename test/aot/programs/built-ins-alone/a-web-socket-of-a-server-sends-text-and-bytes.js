const { promise, resolve } = Promise.withResolvers();
const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    passed.upgrade(request, { data: { size: 1.5 } });
  },
  websocket: {
    open(socket) {
      console.log(socket.send("one") > 0, socket.sendText("two") > 0, socket.sendBinary(new Uint8Array([51])) > 0, socket.ping() > 0, socket.pong() > 0);
      const corked = socket.cork(function (passed) {
        console.log(passed === socket, arguments.length);
        return { size: 1.5 };
      });
      console.log(typeof corked);
    },
    message(socket) {
      socket.terminate();
    },
    close() {
      resolve();
    },
  },
});
const client = new WebSocket(server.url);
let messages = 0;
client.binaryType = "arraybuffer";
client.onmessage = event => {
  messages++;
  console.log(typeof event.data === "string" ? event.data : new Uint8Array(event.data)[0]);
  if (messages === 3) client.send("enough");
};
await promise;
await server.stop(true);
