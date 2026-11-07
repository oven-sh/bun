// atob() throws an object that native code made, of a class that the program does not name, and `error` is handed it.
// STATISTIC: ImageFunctionsEmitted <= 30
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open() {
      atob("*");
    },
    data() {},
    error(socket, error) {
      console.log(error.name, error.code, error instanceof Error);
    },
    close() {
      listener.stop(true);
    },
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${listener.port}`]);
