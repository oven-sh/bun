// A _dump of the program's on a request runs while the library finishes the response, in front of the store that takes the socket away, as in Node. A cork() that it makes is handed back to the connection, a value that it lays under `socket` takes the store, and a detachSocket that it lays is called.
const http = require("node:http"), net = require("node:net");
const out = [];
const slot = res => Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "socket").get.call(res);
const deeds = {
  "corks": res => res.cork(),
  "lays a value under socket": res => Object.defineProperty(res, "socket", { value: "laid", writable: true, enumerable: true, configurable: true }),
  "lays a detachSocket": res => {
    res.detachSocket = function (socket) {
      out.push("  the detachSocket of the program is called");
      return http.ServerResponse.prototype.detachSocket.call(this, socket);
    };
  },
};
const names = Object.keys(deeds);
let turn = 0, client;
const server = http.createServer((req, res) => {
  const socket = req.socket, name = names[turn];
  req._dump = function () {
    deeds[name](res);
    return http.IncomingMessage.prototype._dump.call(this);
  };
  res.end("ok");
  setImmediate(() => setImmediate(() => {
    out.push(name + ": own " + Object.hasOwn(res, "socket") + ", res.socket " + res.socket + ", the slot " + (slot(res) === socket ? "the connection" : slot(res)) + ", corks " + res.writableCorked + "/" + socket.writableCorked);
    if (++turn < names.length) return void connect();
    console.log(out.join("\n"));
    server.close();
  }));
  setImmediate(() => client.destroy());
});
function connect() {
  client = net.connect(server.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.resume();
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
}
server.listen(0, "127.0.0.1", connect);
