// Species: proxy programs  the data of a socket is stored and read through unknown receivers. It prints what plain Bun prints.
const log = [];
class State { constructor() { this.seen = 0; } more(by) { this.seen += by; return this.seen; } }
const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
  open(socket) { globalThis.__socket = socket; globalThis.__socket.data = new State(); },
  data(socket, bytes) { log.push(String(socket.data.more(bytes.length)), String(globalThis.__socket.data.more("!"))); socket.end(); },
  close() { server.stop(); console.log(log.join("; ")); },
} });
const client = await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open(socket) { socket.write("abc"); }, data() {}, close() {} } });
