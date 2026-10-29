// A listener without data calls its serverName handler with undefined as `this`: the store throws, and the handshake ends.
const finished = Promise.withResolvers();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: true,
  socket: {
    data() {},
    serverName() {
      this.calls = 1;
    },
  },
});
Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  tls: { serverName: "localhost" },
  socket: {
    data() {},
    close() {
      finished.resolve();
    },
  },
}).catch(() => {});
await finished.promise;
listener.stop(true);
console.log("done");
