// res.socket = an object of the program's own with a mark of 1, in front of the first write: write() answers by the mark that res.writableHighWaterMark gives.
import http from "node:http";
import net from "node:net";
const log = [];
const server = http.createServer((req, res) => {
  const connection = res.socket;
  if (req.url !== "/first") res.socket = { writableHighWaterMark: 1 };
  res.setHeader("Content-Length", 2);
  log.push(`${req.url} ${res.write("ok")} ${res.writableHighWaterMark === 1}`);
  res.socket = connection;
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (asks.length) return void ask();
    client.destroy();
    server.close();
    console.log(log.join(" | "));
  });
});
