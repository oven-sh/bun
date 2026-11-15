import http from "node:http";
import net from "node:net";
let client;
const server = http.createServer((req, res) => {
  endOnceTheServerIsDone();
  const socket = res.socket;
  res.setHeader("Content-Length", 5);
  res.write("ok");
  res.strictContentLength = true;
  try {
    res.end();
  } catch (error) {
    console.log("end() throws", error.code, error.message);
  }
  console.log(res.headersSent, res.finished, res.writableEnded);
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1");
  let text = "";
  client.on("data", bytes => (text += bytes.toString("latin1")));
  client.on("error", () => {});
  client.on("close", () => {
    console.log(JSON.stringify(text.replace(/^(Date|Connection|Keep-Alive): .*\r\n/gim, "")));
    server.close();
    server.closeAllConnections();
  });
  client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
// No clock says that no more will come. The request goes out by one write, so all of it has come once the listener is entered. What the server still does from there is work of this
// process alone, and takes the same turns of the loop however busy the machine is. Then the client ends its half of the connection, the server closes, and whatever was written comes
// in front of the close.
async function endOnceTheServerIsDone() {
  for (let i = 0; i < 16; i++) await new Promise(setImmediate);
  client.end();
}
