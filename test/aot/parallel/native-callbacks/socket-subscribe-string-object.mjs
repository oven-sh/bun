// The subscribe of a socket of a server converts a String object that is the topic by calling its own toString.
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
      socket.subscribe(text);
      console.log(calls, socket.isSubscribed("b"));
      socket.close();
    },
    message() {},
    close() {
      server.stop(true);
    },
  },
});
new WebSocket(`ws://localhost:${server.port}`);
