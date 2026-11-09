import http from "node:http";
import net from "node:net";
const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  const socket = res.socket as net.Socket;
  res.writeHead(200, { "Content-Length": 4 });
  res.write("ab");
  res.detachSocket(socket);
  socket.write("cd");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  let text = "";
  client.on("data", (bytes: Buffer) => (text += bytes.toString("latin1")));
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  setTimeout(() => {
    console.log(JSON.stringify(text.replace(/^(Date|Connection|Keep-Alive): .*\r\n/gim, "")));
    client.destroy();
    server.close();
    server.closeAllConnections();
  }, 300);
});
