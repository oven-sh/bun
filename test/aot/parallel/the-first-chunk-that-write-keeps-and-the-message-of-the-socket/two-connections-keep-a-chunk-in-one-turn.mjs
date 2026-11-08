import http from "node:http";
import net from "node:net";
const waiting = [];
const server = http.createServer((req, res) => {
  waiting.push(res);
  if (waiting.length < 2) return;
  for (const [index, held] of waiting.entries()) {
    held.setHeader("Content-Length", 4);
    held.write("ab" + index);
  }
  for (const held of waiting) {
    const socket = held.socket;
    socket._httpMessage = null;
    socket.write("!");
  }
});
server.listen(0, "127.0.0.1", () => {
  const texts = ["", ""];
  const clients = texts.map((_, index) => {
    const client = net.connect(server.address().port, "127.0.0.1");
    client.on("data", bytes => (texts[index] += bytes.toString("latin1")));
    setTimeout(() => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"), index * 30);
    return client;
  });
  setTimeout(() => {
    for (const text of texts) console.log(JSON.stringify(text.replace(/^(Date|Connection|Keep-Alive): .*\r\n/gim, "")));
    for (const client of clients) client.destroy();
    server.close();
    server.closeAllConnections();
  }, 400);
});
