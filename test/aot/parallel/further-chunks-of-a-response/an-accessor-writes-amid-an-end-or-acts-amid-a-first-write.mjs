// An accessor of the program on a name that end() or a first write() reads behind the place where its road is taken writes a chunk, which is held under a Content-Length, or ends or destroys the response: native code gets what was held first and refuses the second head, as without compilation. The same deed in front of the call is the control.
import http from "node:http";
let row = [], line = "";
const acts = { writes: res => res.write("x"), ends: res => res.end("x"), destroys: res => res.destroy() };
const server = http.createServer((req, res) => {
  const [where, call, name, at, act] = row;
  res.on("error", error => { line += " . error event " + error.code; });
  if (call === "second write") res.write("o"); else res.setHeader("Content-Length", "1");
  const own = res[name]; let reads = 0;
  Object.defineProperty(res, name, { configurable: true, get() { if (where === "amid" && ++reads === at) acts[act](res); return own; }, set(value) {} });
  try {
    if (where === "in front") acts[act](res);
    line = call === "end" ? (res.end("k"), "returns") : "gives " + res.write("k");
  } catch (error) { line = "throws " + error.code; }
  try { if (!res.writableEnded && !res.destroyed) res.end(); } catch (error) { line += " . then " + error.code; res.destroy(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const guard = setTimeout(() => { console.log("did not end by itself"); process.exit(1); }, 30000);
const cases = [
  ["end", "sendDate", 1, "writes"], ["end", "statusMessage", 1, "writes"], ["end", "sendDate", 1, "destroys"],
  ["first write", "sendDate", 1, "ends"], ["first write", "sendDate", 1, "writes"], ["first write", "sendDate", 1, "destroys"],
];
for (const where of ["amid", "in front"]) for (const one of cases) {
  if (where === "in front" && one[3] === "writes") continue;
  row = [where, ...one];
  let seen = "no body";
  try { seen = await (await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(3000) })).text(); } catch {}
  await new Promise(resolve => setImmediate(resolve));
  console.log(row.join(" ") + ": " + line + " . " + seen);
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
