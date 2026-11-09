// A getter of the object that writeHead() is handed calls writeHead(), flushHeaders(), write() or end() on the response, or wraps setHeader() of outgoing messages: the header whose value it gives is refused or goes through the wrapper, as without compilation.
import http from "node:http";
let way = "", line = "";
const log = [];
const called = [];
const original = http.OutgoingMessage.prototype.setHeader;
const acts = {
  writeHead: res => res.writeHead(201),
  flushHeaders: res => res.flushHeaders(),
  write: res => res.write("a"),
  end: res => res.end("early"),
  wraps: res => {
    http.OutgoingMessage.prototype.setHeader = function (name, value) {
      called.push(name);
      return original.call(this, name, value);
    };
  },
};
const server = http.createServer((req, res) => {
  const act = acts[way];
  try {
    res.writeHead(200, { "x-first": "0", get "x-made-up"() { act(res); return "1"; }, "x-last": "2" });
    line = "taken";
  } catch (error) {
    line = "refused " + error.code;
  }
  try {
    if (!res.writableEnded) res.end("ok");
  } catch (error) {
    line += " . end() throws " + error.code;
    res.destroy();
  }
  http.OutgoingMessage.prototype.setHeader = original;
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (const turn of [1, 2]) {
  for (way of Object.keys(acts)) {
    let seen = "no body";
    try {
      const answer = await fetch(url);
      seen = `${answer.status} ${answer.headers.get("x-first")} ${answer.headers.get("x-made-up")} ${answer.headers.get("x-last")} ${await answer.text()}`;
    } catch {}
    log.push(`${turn} ${way}: ${line} . ${seen} . called for: ${called.splice(0).join()}`);
  }
}
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
