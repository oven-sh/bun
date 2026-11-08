import http from "node:http";
import net from "node:net";
const server = http.createServer((req, res) => {
  const socket = res.socket;
  res.writeHead(200, { "Content-Length": 4 });
  res.write("ab");
  res._send("cd");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let text = "";
  client.on("data", bytes => (text += bytes.toString("latin1")));
  client.on("error", () => {});
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  setTimeout(() => {
    console.log(JSON.stringify(text.replace(/^(Date|Connection|Keep-Alive): .*\r\n/gim, "")));
    client.destroy();
    server.close();
    server.closeAllConnections();
  }, 300);
});
if ((0, eval)("1 + 1") !== 2) console.log("no eval");
