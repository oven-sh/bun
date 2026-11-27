// As its neighbor at the first statement, by require(), from a function that runs in front of everything else that the program does with node:http.
(function first() {
  require("node:_http_incoming").IncomingMessage.prototype.httpVersionMinor = 0;
})();
const http = require("node:http");
const seen = [];
const server = http.createServer((request, response) => {
  seen.push([request.httpVersionMajor, request.httpVersionMinor, request.httpVersion, Object.hasOwn(request, "httpVersionMinor"), response.shouldKeepAlive].join(" "));
  response.end("ok");
});
server.listen(0, async () => {
  for (let turn = 0; turn < 3; turn++) await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
  console.log(seen.join(" | "));
  server.close();
});
