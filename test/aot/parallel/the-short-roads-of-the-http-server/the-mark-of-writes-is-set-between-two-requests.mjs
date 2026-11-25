// The mark of the writable side is written while no request is under way: the first write of the next response goes by it.
import http from "node:http";
import net from "node:net";
const log = [];
let connection;
const server = http.createServer((req, res) => {
  connection = req.socket;
  res.setHeader("Content-Length", 2);
  log.push(`${req.url} ${res.write("ok")}`);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third", "/fourth"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (asks.length === 2) connection._writableState.highWaterMark = 2;
    if (asks.length === 1) connection._writableState.highWaterMark = 3;
    if (asks.length) return void ask();
    client.destroy();
    server.close();
    console.log(log.join(" | "));
  });
});
