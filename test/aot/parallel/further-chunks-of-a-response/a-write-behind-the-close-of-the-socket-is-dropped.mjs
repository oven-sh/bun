// The handler destroys its socket between two writes: what is written behind the head is dropped, whatever its encoding, and write() says so.
import http from "node:http";
import net from "node:net";
const log = [];
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`${requests}: ${res.write("first")}`);
  if (requests < 3) return void res.end();
  req.socket.destroy();
  log.push(res.write("second"), res.write("third", "no-such-encoding"), res.write(""), res.write(Buffer.from("fourth")));
  log.push(res.writableLength, res.finished, res.destroyed);
  res.end();
  log.push(res.finished);
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (String(bytes).endsWith("0\r\n\r\n")) ask();
  });
  client.on("close", () => {
    server.close();
    console.log(log.join(" | "));
  });
});
