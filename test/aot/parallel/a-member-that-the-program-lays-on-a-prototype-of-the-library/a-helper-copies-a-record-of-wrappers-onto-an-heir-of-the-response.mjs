import http from "node:http";
import util from "node:util";
function Reply(req, options) { http.ServerResponse.call(this, req, options); }
Object.setPrototypeOf(Reply.prototype, http.ServerResponse.prototype);
Object.setPrototypeOf(Reply, http.ServerResponse);
function lay(o) { Object.assign(Reply.prototype, o); }
const log = [];
process.noDeprecation = true;
lay({ hasHeader: util.deprecate(function (name) { log.push(`hasHeader ${name}`); return http.ServerResponse.prototype.hasHeader.call(this, name); }, "made up", "MADE_UP"), setHeader: util.deprecate(function (name, value) { log.push(`setHeader ${name}`); return http.ServerResponse.prototype.setHeader.call(this, name, value); }, "made up", "MADE_UP2") });
const server = http.createServer({ ServerResponse: Reply }, (req, res) => {
  log.push(`is a reply ${res instanceof Reply}`);
  res.setHeader("X-Made-Up", "1");
  log.push(`asked ${res.hasHeader("x-made-up")} ${res.getHeader("x-made-up")}`);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("x");
});
server.listen(0, "127.0.0.1", async () => {
  const answer = await fetch(`http://127.0.0.1:${server.address().port}/`);
  log.push(`got ${await answer.text()} ${answer.headers.get("x-made-up")}`);
  server.close();
  console.log(log.join("\n"));
});
