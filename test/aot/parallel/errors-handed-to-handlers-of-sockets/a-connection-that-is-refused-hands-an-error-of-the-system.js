// Nobody listens there any more: `connectError` is handed an error that native code makes, with the members of an error of the system.
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
const port = listener.port;
listener.stop(true);
Bun.connect({
  hostname: "127.0.0.1",
  port,
  socket: {
    data() {},
    connectError(socket, error) {
      console.log(error instanceof Error, Object.getPrototypeOf(error) === Error.prototype, error.name, error.code, error.syscall, typeof error.message, typeof error.stack);
    },
  },
}).catch(error => console.log("rejected", error.code));
