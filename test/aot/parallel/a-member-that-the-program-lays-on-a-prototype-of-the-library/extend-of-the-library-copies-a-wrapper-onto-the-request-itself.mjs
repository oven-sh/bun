import http from "node:http";
import util from "node:util";
import stream from "node:stream";
import events from "node:events";
function Ask(socket) { http.IncomingMessage.call(this, socket); }
Object.setPrototypeOf(Ask.prototype, http.IncomingMessage.prototype);
Object.setPrototypeOf(Ask, http.IncomingMessage);
const log = [];
process.noDeprecation = true;
util._extend(http.IncomingMessage.prototype, { push: util.deprecate(function (...rest) { log.push(`push ${typeof rest[0]}`); return stream.Readable.prototype.push.apply(this, rest); }, "made up", "MADE_UP") });
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
