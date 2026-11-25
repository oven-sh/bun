// A plain value between a server and Server.prototype, under a name under which the library itself lays an accessor on its servers: the own accessor hides it, and nobody promised that it is not there.
// Under: --aot-harden=proof-checks: the net on the yes of $isPlainInstanceOf asked every field's name, and stopped a right program
// Under: --aot-testing=CheckWalkAtRunTime: the same net
const http = require("node:http");
const server = http.createServer((q, r) => r.end("ok"));
server.listen(0, "127.0.0.1", async () => {
  // Behind listen(): the library notes there, once, whether the server is its own, and asks the door of no other.
  const between = Object.create(http.Server.prototype);
  between.maxHeadersCount = 7;
  Object.setPrototypeOf(server, between);
  const url = "http://127.0.0.1:" + server.address().port;
  const a = await fetch(url), first = await a.text(), b = await fetch(url), second = await b.text();
  console.log("SAID", a.status, first, b.status, second, server.maxHeadersCount, Object.getPrototypeOf(server).maxHeadersCount);
  server.closeAllConnections();
  server.close();
});
