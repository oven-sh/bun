// A writeHead() of the program's own, laid on the response or on the prototype alone, writes, ends, flushes or destroys while end() or write() calls it. No accessor is involved, and with the wrapper on the prototype every response is as its class made it. The same deed in front of the call is the control.
import http from "node:http";
let row = [], line = "";
const log = [];
const acts = {
  writes: res => res.write("x"),
  ends: res => res.end("x"),
  flushes: res => res.flushHeaders(),
  destroys: res => res.destroy(),
};
const prototype = http.ServerResponse.prototype;
const original = prototype.writeHead;
let calls = 0;
const server = http.createServer((req, res) => {
  const [holder, where, call, act] = row;
  calls = 0;
  const wrapper = function (...values) {
    original.apply(this, values);
    if (++calls === 1) acts[act](this);
    return this;
  };
  res.on("error", error => {
    line += ` . error event ${error.code}`;
  });
  res.setHeader("Content-Length", "1");
  if (holder === "the response") res.writeHead = wrapper;
  else prototype.writeHead = wrapper;
  try {
    if (where === "in front") res.writeHead(200);
    line = call === "end" ? (res.end("k"), "returns") : `gives ${res.write("k")}`;
  } catch (error) {
    line = `throws ${error.name} ${error.code}`;
  }
  prototype.writeHead = original;
  line += ` . own writeHead ${Object.hasOwn(res, "writeHead")} . calls ${calls}`;
  try {
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (error) {
    line += ` . then ${error.code}`;
    res.destroy();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const guard = setTimeout(() => {
  console.log(log.join("\n"));
  console.log("did not end by itself");
  process.exit(1);
}, 60000);
const url = "http://127.0.0.1:" + server.address().port;
for (const holder of ["the response", "the prototype"]) {
  for (const where of ["amid", "in front"]) {
    for (const call of ["end", "write"]) {
      for (const act of Object.keys(acts)) {
        row = [holder, where, call, act];
        let seen = "no body";
        try {
          seen = await (await fetch(url, { signal: AbortSignal.timeout(3000) })).text();
        } catch {}
        await new Promise(resolve => setImmediate(resolve));
        log.push(`${row.join(" . ")}: ${line} . ${JSON.stringify(seen)}`);
      }
    }
  }
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
