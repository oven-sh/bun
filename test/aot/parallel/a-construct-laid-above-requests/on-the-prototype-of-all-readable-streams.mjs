// A program lays a _construct on the prototype of all readable streams: a stream calls what it finds under that name while it is made, so every request of a server calls it.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

let calls = 0;
Readable.prototype._construct = function (callback) {
  if (this instanceof http.IncomingMessage) calls++;
  callback();
};
const sockets = new Set();
const server = http.createServer((req, res) => {
  sockets.add(req.socket);
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const client = net.connect(server.address().port, "127.0.0.1");
client.setEncoding("latin1");
let arrived = "";
let whole = () => {};
client.on("data", part => {
  arrived += part;
  if (arrived.endsWith("ok")) whole();
});
for (let i = 0; i < 3; i++) {
  arrived = "";
  await new Promise(resolve => {
    whole = resolve;
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
  console.log("requests", i + 1, "connections", sockets.size, "calls", calls);
}
client.destroy();
server.close();
