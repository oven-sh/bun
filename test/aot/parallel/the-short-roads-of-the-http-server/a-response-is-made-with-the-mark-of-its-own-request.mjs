// A response keeps the mark that its socket has when the request comes, for the time when it has no socket. The program finds it among the keys of the response.
import http from "node:http";
import net from "node:net";
const log = [];
let connection;
const server = http.createServer((req, res) => {
  connection = req.socket;
  const key = Object.getOwnPropertySymbols(res).find((symbol) => symbol.description === "kHighWaterMark");
  log.push(`${req.url} ${res[key] === connection.writableHighWaterMark}`);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (asks.length === 1) connection._writableState.highWaterMark = 7;
    if (asks.length) return void ask();
    client.destroy();
    server.close();
    console.log(log.join(" | "));
  });
});
