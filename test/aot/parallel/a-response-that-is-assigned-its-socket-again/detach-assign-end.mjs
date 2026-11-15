import http from "node:http";
import net from "node:net";
const counts = [];
const server = http.createServer((req, res) => {
  const socket = req.socket;
  counts.push(socket.listenerCount("close"));
  res.detachSocket(socket);
  res.assignSocket(socket);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("data", bytes => {
    if (!String(bytes).endsWith("ok")) return;
    if (++answers < 5) return void setTimeout(ask, 10);
    console.log(counts.join(" "));
    client.destroy();
    server.close();
  });
  ask();
});
