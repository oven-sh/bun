// The bytes of a request are activity of the socket: _unrefTimer() is called, and the program has replaced it on the socket.
import http from "node:http";
let calls = 0;
const server = http.createServer((req, res) => res.end("ok"));
server.on("connection", (socket) => {
  const original = socket._unrefTimer;
  socket._unrefTimer = function () {
    calls++;
    return original.call(this);
  };
});
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/");
  await answer.text();
  console.log("calls " + calls);
  server.close();
  server.closeAllConnections();
});
/* Output:
calls 1
*/
