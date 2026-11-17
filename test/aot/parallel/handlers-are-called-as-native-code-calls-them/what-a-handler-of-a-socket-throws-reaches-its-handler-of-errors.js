const log = new Set();
const kind = each => each === null ? "null" : each === undefined ? "undefined" : typeof each === "object" ? each.constructor.name : typeof each;
const { promise, resolve } = Promise.withResolvers();
const thrown = { mine: 1, note: "thrown by the handler" };
function read(o) { let work = 0; for (let k = 0; k < 2; k++) work += k; return o.mine; }
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, data) { throw thrown; },
    error(socket, error) { log.add("error " + kind(socket) + " " + kind(error) + " " + (error === thrown)); error.mine = "changed"; socket.end(); },
    close(socket) { resolve(); },
  },
});
await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { open(socket) { socket.write("x"); }, data() {}, close() {} } });
await promise;
listener.stop(true);
console.log([...log].sort().join("\n"), read(thrown), typeof thrown.mine);
