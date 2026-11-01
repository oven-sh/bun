// An untyped listener mutates the request and the response before passing them to functions that read them: a deleted member, a getter in its place,
// another prototype, no prototype, a late member, an own method, members of other types.
const http = require("node:http");
const log = [];
function read(req) {
  return `${req.method} ${req.url} ${typeof req.headers} ${req.extra}`;
}
function finish(res, text) {
  res.setHeader("X-Turn", text);
  res.end(text);
}
let turn = 0;
function listener(req, res) {
  switch (turn++) {
    case 0:
      delete req.url;
      break;
    case 1:
      Object.defineProperty(req, "url", { get: () => "/from-a-getter", configurable: true });
      break;
    case 2:
      Object.setPrototypeOf(req, { extra: "from another prototype", method: "never seen" });
      break;
    case 3:
      Object.setPrototypeOf(req, null);
      break;
    case 4:
      req.extra = "late";
      break;
    case 5:
      res.setHeader = function (name, value) {
        log.push(`own setHeader ${name} ${value}`);
        return http.ServerResponse.prototype.setHeader.call(this, name, value);
      };
      break;
    case 6:
      Object.setPrototypeOf(res, Object.create(http.ServerResponse.prototype, { end: { value(text) { log.push("end of another prototype"); return http.ServerResponse.prototype.end.call(this, text); } } }));
      break;
    case 7:
      req.method = 7;
      req.url = { toString: () => "/an-object" };
      break;
  }
  log.push(read(req));
  if (Object.getPrototypeOf(req) !== http.IncomingMessage.prototype) Object.setPrototypeOf(req, http.IncomingMessage.prototype);
  log.push(read(req));
  finish(res, `turn ${turn}`);
}
const server = http.createServer(listener);
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < 9; i++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/path-${i}`);
    log.push(`${response.status} ${response.headers.get("x-turn")} ${await response.text()}`);
  }
  console.log(log.join("\n"));
  server.close();
});
