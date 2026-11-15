// cork() of a response that has ended counts, as in Node, and the connection gets the cork back when the response lets go of it at 'finish': an 'upgrade' that comes later on the connection finds it uncorked. The response has no listener, so it finishes on the short road.
const http = require("node:http"), net = require("node:net");
const out = [];
const orders = {
  "end, cork": res => (res.end("ok"), res.cork()),
  "cork, end, cork": res => (res.cork(), res.end("ok"), res.cork()),
  "a tick queued in front of end() corks": res => (process.nextTick(() => res.cork()), res.end("ok")),
  "the callback of a write corks": res => (res.write("a", () => res.cork()), res.end("b")),
};
const names = Object.keys(orders);
let turn = 0, client, heard = "";
const server = http.createServer((req, res) => {
  const socket = req.socket, name = names[turn];
  orders[name](res);
  setImmediate(() => setImmediate(() => {
    out.push(name + ": the response counts " + res.writableCorked + ", the connection " + socket.writableCorked + ", res.socket " + res.socket);
    client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
  }));
});
server.on("upgrade", (req, socket) => {
  out.push(names[turn] + ": the connection at 'upgrade' " + socket.writableCorked);
  socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
});
function connect() {
  heard = "";
  client = net.connect(server.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.on("data", chunk => (heard += chunk));
  client.on("close", () => {
    out.push(names[turn] + ": the client heard a 101 " + heard.includes("101 Switching"));
    if (++turn < names.length) return connect();
    console.log(out.join("\n"));
    server.close();
  });
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
}
server.listen(0, "127.0.0.1", connect);
