// A listener of "connection" writes the high water marks of the socket: the request and the response go by the marks as they are when the request comes.
import http from "node:http";
const log = [];
const server = http.createServer((req, res) => {
  res.setHeader("Content-Length", 3);
  const took = res.write("abc");
  log.push("request mark " + req.readableHighWaterMark, "write " + took);
  res.end();
});
server.on("connection", (socket) => {
  socket._readableState.highWaterMark = 1234;
  socket._writableState.highWaterMark = 1;
});
server.listen(0, async () => {
  const answer = await fetch("http://127.0.0.1:" + server.address().port + "/");
  log.push(await answer.text());
  console.log(log.join(" | "));
  server.close();
  server.closeAllConnections();
});
/* Output:
request mark 1234 | write false | abc
*/
