// The server constructs a response of the class it was given and none besides, also where the program hears the stores of a constructor.
const http = require("node:http");
const counts = new WeakMap();
const constructed = new Set();
Object.defineProperty(http.OutgoingMessage.prototype, "_eventsCount", {
  configurable: true,
  get() {
    return counts.get(this) ?? 0;
  },
  set(value) {
    if (this instanceof http.ServerResponse) constructed.add(this);
    counts.set(this, value);
  },
});
class Answer extends http.ServerResponse {}
const server = http.createServer({ ServerResponse: Answer }, (req, res) => {
  res.setHeader("X-Path", req.url);
  res.removeHeader("x-none");
  if (req.url === "/written") {
    res.writeHead(201, { "X-Written": "yes" });
    res.write("part ");
  }
  res.end(`ok ${res.getHeader("x-path")}`);
});
server.listen(0, "127.0.0.1", async () => {
  for (const path of ["/ended", "/written"]) {
    const answer = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    console.log(answer.status, answer.headers.get("x-path"), answer.headers.get("x-written"), await answer.text());
  }
  console.log(constructed.size, [...constructed].every(each => each instanceof Answer));
  server.close();
  server.closeAllConnections();
});
