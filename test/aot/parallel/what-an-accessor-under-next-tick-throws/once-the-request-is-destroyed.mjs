// The accessor throws at the first read that finds the request destroyed, and answers at every other. _destroy() reads the name behind the mark, once: the error closes the request, which emits `error` and `close`. Nobody reads the name behind that.
import http from "node:http";
const own = Object.getOwnPropertyDescriptor(process, "nextTick");
const lines = [];
process.on("uncaughtException", error => lines.push("  uncaught: " + error.message));
let deed;
const server = http.createServer((req, res) => {
  let hasThrown = false;
  req.on("error", error => lines.push("  the request emits error: " + error.message));
  req.on("close", () => lines.push("  the request closes, errored " + (req.errored && req.errored.message)));
  Object.defineProperty(process, "nextTick", {
    configurable: true,
    get() {
      if (req.destroyed && !hasThrown) {
        hasThrown = true;
        throw new Error("read while the request is destroyed");
      }
      return own.value;
    },
  });
  deed(req, res);
});
function ends(req, res) {
  res.end("ok");
}
function resumes(req, res) {
  req.resume();
  res.end("ok");
}
function reads(req, res) {
  req.on("data", () => {});
  req.on("end", () => res.end("ok"));
}
await new Promise(done => server.listen(0, "127.0.0.1", done));
for (deed of [ends, resumes, reads]) {
  for (const options of [{}, { method: "POST", body: "sent" }]) {
    lines.push(deed.name + (options.body ? " with a body:" : ":"));
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/", options);
    const text = await response.text();
    for (let turn = 0; turn < 4; turn++) await new Promise(done => setImmediate(done));
    Object.defineProperty(process, "nextTick", own);
    lines.push("  " + response.status + " " + text);
  }
}
console.log(lines.join("\n"));
server.closeAllConnections();
await new Promise(done => server.close(done));
