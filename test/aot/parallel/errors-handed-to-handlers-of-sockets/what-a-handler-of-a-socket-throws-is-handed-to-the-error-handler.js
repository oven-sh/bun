// What `open` throws, an object of a class of the program, is what `error` is handed: with its methods.
class Refusal {
  constructor(why) {
    this.why = why;
  }
  describe() {
    return "refused: " + this.why;
  }
}
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(socket) { socket.end(); }, data() {} } });
Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  socket: {
    open() {
      throw new Refusal("not today");
    },
    data() {},
    error(socket, error) {
      console.log(error instanceof Refusal, error.describe());
    },
    close(socket, error) {
      console.log("closed", error);
      listener.stop(true);
    },
  },
});
