import http from "node:http";
import util from "node:util";
function Ask(socket) { http.IncomingMessage.call(this, socket); }
Object.setPrototypeOf(Ask.prototype, http.IncomingMessage.prototype);
Object.setPrototypeOf(Ask, http.IncomingMessage);
function lay(o) { Ask.prototype.push = o; }
const log = [];
process.noDeprecation = true;
lay(util.deprecate(function (...rest) { log.push(`push ${typeof rest[0] === "string" ? rest[0] : typeof rest[0]}`); return http.IncomingMessage.prototype.push.apply(this, rest); }, "made up", "MADE_UP"));
const server = http.createServer({ IncomingMessage: Ask }, (req, res) => {
  log.push(`is an ask ${req instanceof Ask}`);
  let body = "";
  req.on("data", chunk => { body += chunk; }); req.on("end", () => { log.push(`body ${body}`); res.end("x"); });
});
server.listen(0, "127.0.0.1", async () => {
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: "made up body" });
  log.push(`got ${await answer.text()}`);
  server.close();
  console.log(log.join("\n"));
});
