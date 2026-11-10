const log = new Set();
const kind = each => each === null ? "null" : each === undefined ? "undefined" : typeof each === "object" ? each.constructor.name : typeof each;
const { promise, resolve } = Promise.withResolvers();
let turn = 0;
const server = Bun.serve({
  port: 0,
  fetch(request, server) { return server.upgrade(request) ? undefined : new Response("no"); },
  websocket: {
    open(socket) { log.add("open " + kind(this) + " " + kind(socket)); },
    message(socket, message) {
      log.add("message " + kind(this) + " " + kind(socket) + " " + socket.binaryType + " " + kind(message) + " " + (message.byteLength ?? message.length));
      turn++;
      socket.binaryType = ["nodebuffer", "arraybuffer", "uint8array"][turn % 3];
      socket.send("next");
    },
    ping(socket, data) { log.add("ping " + kind(this) + " " + kind(socket) + " " + kind(data) + " " + data.length); },
    pong(socket, data) { log.add("pong " + kind(this) + " " + kind(socket) + " " + kind(data) + " " + data.length); },
    drain(socket) { log.add("drain " + kind(this) + " " + kind(socket)); },
    close(socket, code, reason) { log.add("close " + kind(this) + " " + kind(socket) + " " + kind(code) + " " + code + " " + kind(reason) + " " + reason); resolve(); },
  },
});
const client = new WebSocket(String(server.url).replace("http", "ws"));
let sent = 0;
client.onopen = () => { client.ping("p"); client.pong("q"); client.send(new Uint8Array([1, 2, 3])); };
client.onmessage = () => { if (++sent < 4) client.send(sent === 3 ? "text" : new Uint8Array(sent)); else client.terminate(); };
await promise;
await server.stop(true);
console.log([...log].sort().join("\n"));
