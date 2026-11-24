// The name leaves the file in sight, and the program lays its own function on a prototype of a class that it reaches through the name: the library calls it.
import http from "node:http";
const log = [];
http.ServerResponse.prototype.hasHeader = function (name) {
  log.push(`hasHeader ${name}`);
  return http.OutgoingMessage.prototype.hasHeader.call(this, name);
};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("x");
});
server.listen(0, "127.0.0.1", async () => {
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/`);
  await answer.text();
  server.close();
  console.log(log.join("\n"));
});
