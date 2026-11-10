// `open` throws an object of a class of the program, and `error` is handed it and calls its method. The connection comes from a shell, without a promise, so little of the library stands beside it.
// STATISTIC: ImageFunctionsEmitted <= 30
class Refusal {
  constructor(why) {
    this.why = why;
  }
  describe() {
    return "refused: " + this.why;
  }
}
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open() {
      throw new Refusal("not today");
    },
    data() {},
    error(socket, error) {
      console.log(error instanceof Refusal, error.describe());
    },
    close(socket, error) {
      console.log("closed", error === undefined);
      listener.stop(true);
    },
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${listener.port}`]);
