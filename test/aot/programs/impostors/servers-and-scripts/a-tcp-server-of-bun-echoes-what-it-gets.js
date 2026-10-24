const log = [];
const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: { name: "server side" },
  socket: {
    open(socket) {
      socket.data = { received: 0 };
      log.push("server open");
    },
    data(socket, chunk) {
      socket.data.received += chunk.length;
      socket.write("echo:" + chunk.toString());
      if (chunk.toString().endsWith("bye")) socket.end();
    },
    close(socket) {
      log.push("server close after " + socket.data.received);
    },
    error(socket, error) {
      log.push("server error " + error.message);
    },
  },
});

let text = "";
const closed = Promise.withResolvers();
const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port,
  socket: {
    open(socket) {
      log.push("client open " + socket.remoteAddress + " " + (socket.localPort > 0));
      socket.write("hello ");
    },
    data(socket, chunk) {
      text += chunk.toString();
      if (text === "echo:hello ") socket.write(new TextEncoder().encode("and bye"));
    },
    end() {
      log.push("client end");
    },
    close() {
      closed.resolve();
    },
  },
});
await closed.promise;
await Bun.sleep(5);
console.log(text, log.sort(), typeof client.readyState, server.hostname, typeof server.port);
server.stop(true);
console.log(await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {} } }).catch(error => error.code));
