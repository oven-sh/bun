// The isSubscribed of a socket of a server converts a String object that is the topic by calling its own toString.
let calls = 0;
const text = new String("a");
text.toString = () => {
  calls++;
  return "b";
};
const server = Bun.serve({
  port: 0,
  fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no")),
  websocket: {
    open(socket) {
      socket.subscribe("b");
      console.log(socket.isSubscribed(text), calls);
      socket.close();
    },
    message() {},
    close() {
      server.stop(true);
    },
  },
});
new WebSocket(`ws://localhost:${server.port}`);
