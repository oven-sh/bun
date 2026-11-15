// A program lays a class of its own under `IncomingMessage` in node:_http_incoming's exports in front of node:http's first load: the servers made behind it construct that class.
const incoming = require("node:_http_incoming");
const Original = incoming.IncomingMessage;
let made = 0;
class Asked extends Original {
  constructor(...given) { super(...given); made++; this.mark = "of the program"; }
}
incoming.IncomingMessage = Asked;
const http = require("node:http");
const server = http.createServer((req, res) => {
  res.end([req instanceof Asked, req instanceof Original, req.mark, req.constructor.name, req.url, made].join(" "));
});
server.listen(0, async () => {
  const at = "http://127.0.0.1:" + server.address().port;
  console.log(await (await fetch(at + "/one")).text());
  console.log(await (await fetch(at + "/two")).text());
  console.log(http.IncomingMessage === Asked, http.IncomingMessage === Original, incoming.IncomingMessage === Asked);
  server.close();
});
