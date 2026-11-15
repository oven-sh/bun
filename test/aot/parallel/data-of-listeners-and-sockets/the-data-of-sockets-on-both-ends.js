// A socket that a listener accepts begins with the data of the listener, one that connects with its own, and each keeps what is stored later.
const ofListener = { name: "of the listener" };
const ofClient = { name: "of the client" };
const said = [];
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: ofListener,
  socket: {
    open(socket) {
      said.push("accepted " + (socket.data === ofListener) + " " + socket.data.name);
      socket.data = { name: "stored later" };
      said.push("then " + socket.data.name);
      socket.end("x");
    },
    data() {},
  },
});
Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  data: ofClient,
  socket: {
    open(socket) {
      said.push("connected " + (socket.data === ofClient) + " " + socket.data.name);
    },
    data() {},
    close() {
      listener.stop(true);
      console.log(said.sort().join("\n"));
    },
  },
});
