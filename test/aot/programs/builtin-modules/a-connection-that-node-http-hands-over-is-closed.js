// A server of node:http hands a connection over to the listener for 'upgrade'. The library holds a promise for the connection, which it settles by itself when the socket closes:
// then the server can close. What is printed does not depend on which side notices the end first.
import http from "node:http";
import net from "node:net";

const seen = { upgrade: "", echoed: "", status: "", closedSides: 0 };
function sideClosed() {
  if (++seen.closedSides < 2) return;
  server.close(() => {
    console.log(seen.upgrade);
    console.log(seen.status);
    console.log(seen.echoed);
    console.log("closed");
  });
}

const server = http.createServer((request, response) => response.end("not handed over"));
server.on("upgrade", (request, socket, head) => {
  seen.upgrade = `${request.method} ${request.url} ${request.headers.upgrade} ${head.length}`;
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
  socket.on("data", chunk => socket.write(String(chunk).toUpperCase()));
  socket.on("end", () => socket.end());
  socket.on("close", sideClosed);
});
server.listen(0, "127.0.0.1", () => {
  let text = "";
  let hasAsked = false;
  const client = net.connect(server.address().port, "127.0.0.1", () => {
    client.write("GET /chat HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
  });
  client.on("data", chunk => {
    text += chunk;
    const end = text.indexOf("\r\n\r\n");
    if (end < 0) return;
    if (!hasAsked) {
      hasAsked = true;
      seen.status = text.slice(0, text.indexOf("\r\n"));
      client.write("hello");
    }
    seen.echoed = text.slice(end + 4);
    if (seen.echoed === "HELLO") client.end();
  });
  client.on("close", sideClosed);
});
