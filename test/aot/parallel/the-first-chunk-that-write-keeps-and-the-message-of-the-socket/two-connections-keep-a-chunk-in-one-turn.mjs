import http from "node:http";
import net from "node:net";
const waiting = [];
let clients;
const ask = client => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
const server = http.createServer((req, res) => {
  waiting.push(res);
  // The second asks once the first has been heard.
  if (waiting.length < 2) return void ask(clients[1]);
  endOnceTheServerIsDone();
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
  let open = texts.length;
  clients = texts.map((_, index) => {
    const client = net.connect(server.address().port, "127.0.0.1");
    client.on("data", bytes => (texts[index] += bytes.toString("latin1")));
    client.on("error", () => {});
    client.on("close", () => {
      if (--open) return;
      for (const text of texts) console.log(JSON.stringify(text.replace(/^(Date|Connection|Keep-Alive): .*\r\n/gim, "")));
      server.close();
      server.closeAllConnections();
    });
    return client;
  });
  ask(clients[0]);
});
// No clock says that no more will come. A request goes out by one write, so all of it has come once the listener is entered. What the server still does from there is work of this
// process alone, and takes the same turns of the loop however busy the machine is. Then each client ends its half of its connection, the server closes it, and whatever was written comes
// in front of the close.
async function endOnceTheServerIsDone() {
  for (let i = 0; i < 16; i++) await new Promise(setImmediate);
  for (const client of clients) client.end();
}
