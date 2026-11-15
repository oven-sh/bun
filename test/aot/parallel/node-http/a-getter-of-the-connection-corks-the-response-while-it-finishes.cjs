// A getter of the program's under `server` on the connection is read while the library finishes the response, and corks the response there. The connection gets the cork back when the response lets go of it, as without compilation: the store that takes the socket away asks the response once more.
const http = require("node:http"), net = require("node:net");
const out = [];
let acted = false, client;
const server = http.createServer((req, res) => {
  const socket = req.socket, held = socket.server;
  Object.defineProperty(socket, "server", {
    configurable: true,
    get() {
      if (!acted && res.finished) {
        acted = true;
        res.cork();
        out.push("corked while the response finishes: the response counts " + res.writableCorked + ", the connection " + socket.writableCorked);
      }
      return held;
    },
    set() {},
  });
  res.end("ok");
  setImmediate(() => {
    out.push("later: the response counts " + res.writableCorked + ", the connection " + socket.writableCorked + ", res.socket " + res.socket);
    console.log(out.join("\n"));
    client.destroy();
    server.close();
  });
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1");
  client.resume();
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
