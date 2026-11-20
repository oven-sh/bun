// A topic that is no string is refused, and the error describes it: it reads `constructor` off the topic and the name off the constructor, which is a getter of the program here.
let asked = 0;
class Topic {
  static get name() {
    asked++;
    return "T";
  }
}
const server = Bun.serve({
  port: 0,
  fetch(request, server) {
    server.upgrade(request);
  },
  websocket: {
    message() {},
    open(socket) {
      try {
        socket.subscribe(new Topic());
      } catch (error) {
        console.log(error.code);
      }
      console.log(asked > 0);
      process.exit(0);
    },
  },
});
new WebSocket(`ws://localhost:${server.port}`);
