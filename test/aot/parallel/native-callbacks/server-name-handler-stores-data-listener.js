// A listener with data calls its serverName handler with that data as `this`: the store adds a property to the data and changes none that it has.
const finished = Promise.withResolvers();
const data = { first: "kept", second: "kept" };
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: true,
  data,
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
console.log(JSON.stringify(data));
