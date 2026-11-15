// An accessor under a field of the request's state, laid behind res.end(). It throws at its first read and answers from then on. Whoever reads the field first lets the error out: nobody asks it on the quiet and goes another way.
import http from "node:http";
const lines = [];
process.on("uncaughtException", error => lines.push("  uncaught: " + error.message));
let field;
const server = http.createServer((req, res) => {
  res.end("ok");
  if (field === undefined) return;
  const state = req._readableState;
  const held = state[field];
  let reads = 0;
  Object.defineProperty(state, field, {
    configurable: true,
    enumerable: true,
    set() {},
    get() {
      if (++reads === 1) throw new Error("the first read of " + field);
      return held;
    },
  });
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = "http://127.0.0.1:" + server.address().port;
async function ask(options) {
  const text = await (await fetch(url, options)).text();
  for (let turn = 0; turn < 4; turn++) await new Promise(done => setImmediate(done));
  return text;
}
await ask();
for (field of ["length", "highWaterMark", "buffer", "pipes"]) {
  lines.push(field + ": " + (await ask()));
  lines.push(field + ", with a body: " + (await ask({ method: "POST", body: "sent" })));
}
console.log(lines.join("\n"));
server.closeAllConnections();
await new Promise(done => server.close(done));
