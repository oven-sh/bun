// The function that the program lays under `hasHeader` on the nearer prototype was made by the library: util.deprecate() wraps. The file stays in sight by require(), and writeHead() asks its guard.
const http = require("node:http");
const util = require("node:util");
const log = [];
process.noDeprecation = true;
http.ServerResponse.prototype.hasHeader = util.deprecate(function (name) {
  log.push(`hasHeader ${name}`);
  return http.OutgoingMessage.prototype.hasHeader.call(this, name);
}, "made up", "MADE_UP");
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
