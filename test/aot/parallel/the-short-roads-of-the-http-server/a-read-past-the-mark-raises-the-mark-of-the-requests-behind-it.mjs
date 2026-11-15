// socket.read(n) with n over the mark raises the mark of the socket. Each request takes the mark that its socket has when the request comes.
import http from "node:http";
import net from "node:net";
const server = http.createServer((req, res) => {
  console.log(req.url, req.readableHighWaterMark === req.socket.readableHighWaterMark);
  if (req.url === "/first") req.socket.read(req.socket.readableHighWaterMark + 1);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("data", () => {
    if (asks.length) ask();
    else {
      client.destroy();
      server.close();
    }
  });
  ask();
});
