// A program stores a class of its own under net.Socket in front of the first server, and deletes the resume() of the library's net.Socket: what is found under `resume` on a server's socket
// is then the streams' own. Which resume() runs, and that requests with and without a body are answered, is as in plain.
const net = require("node:net");
const { Readable } = require("node:stream");
const Library = net.Socket;
const said = [];
class Mine extends Library {
  resume() {
    said.push("resume of Mine");
    return super.resume();
  }
}
net.Socket = Mine;
delete Library.prototype.resume;
const http = require("node:http");
let n = 0;
const server = http.createServer((req, res) => {
  said.push("request " + ++n + " " + req.method + " . is of Mine " + (req.socket instanceof Mine) + " . finds the streams' resume above " + (Library.prototype.resume === Readable.prototype.resume));
  res.end("x#");
});
server.listen(0, "127.0.0.1", () => {
  const client = new Library();
  client.connect(server.address().port, "127.0.0.1");
  const asks = ["GET / HTTP/1.1\r\nHost: a\r\n\r\n", "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi", "GET / HTTP/1.1\r\nHost: a\r\n\r\n"];
  const ask = () => client.write(asks.shift());
  client.on("connect", ask);
  client.on("data", bytes => {
    if (!String(bytes).includes("#")) return;
    if (asks.length) return void ask();
    client.destroy();
    server.close();
    console.log(said.join("\n"));
  });
});
