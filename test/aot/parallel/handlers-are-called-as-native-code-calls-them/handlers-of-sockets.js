const log = new Set();
const kind = each => each === null ? "null" : each === undefined ? "undefined" : typeof each === "object" ? each.constructor.name : typeof each;
const { promise, resolve } = Promise.withResolvers();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) { log.add("server open " + kind(this) + " " + kind(socket)); },
    data(socket, data) { log.add("server data " + kind(this) + " " + kind(socket) + " " + kind(data) + " " + data.length); socket.write("pong"); },
    drain(socket) { log.add("server drain " + kind(this) + " " + kind(socket)); },
    end(socket) { log.add("server end " + kind(this) + " " + kind(socket)); },
    close(socket, error) { log.add("server close " + kind(this) + " " + kind(socket) + " " + kind(error)); resolve(); },
    error(socket, error) { log.add("server error " + kind(this) + " " + kind(socket) + " " + kind(error)); },
  },
});
await Bun.connect({
  hostname: "127.0.0.1",
  port: listener.port,
  socket: {
    open(socket) { log.add("client open " + kind(this) + " " + kind(socket)); socket.write("ping"); },
    data(socket, data) { log.add("client data " + kind(this) + " " + kind(socket) + " " + kind(data) + " " + String(data)); socket.end(); },
    drain(socket) { log.add("client drain " + kind(this) + " " + kind(socket)); },
    end(socket) { log.add("client end " + kind(this) + " " + kind(socket)); },
    close(socket, error) { log.add("client close " + kind(this) + " " + kind(socket) + " " + kind(error)); },
    error(socket, error) { log.add("client error " + kind(this) + " " + kind(socket) + " " + kind(error)); },
    connectError(socket, error) { log.add("client connectError " + kind(this) + " " + kind(socket) + " " + kind(error)); },
  },
});
await promise;
const port = listener.port;
listener.stop(true);
try {
  await Bun.connect({ hostname: "127.0.0.1", port, socket: { open(socket) { log.add("opened a closed port " + kind(socket)); }, data() {}, connectError(socket, error) { log.add("refused connectError " + kind(this) + " " + kind(socket) + " " + kind(error) + " " + error.code); } } });
} catch (error) { log.add("rejected " + kind(error) + " " + error.code); }
console.log([...log].sort().join("\n"));
