// The handler answers from a later turn of the loop, so the native response is outside the parse: an accessor that destroys the response amid write() or end(), behind the place where the full road asks the handle, makes native code throw, and the throw goes on to the caller as without compilation. The same deed in front of the call is the control.
import http from "node:http";
let row = [], line = "";
const acts = { response: (req, res) => res.destroy(), connection: (req, res) => req.socket.destroy() };
const answer = (req, res) => {
  const [where, when, call, name, act] = row;
  res.on("error", error => { line += " . error event " + error.code; });
  if (call === "second write") res.write("o"); else res.setHeader("Content-Length", "1");
  const own = res[name]; let reads = 0;
  Object.defineProperty(res, name, { configurable: true, get() { if (where === "amid" && ++reads === 1) acts[act](req, res); return own; }, set(value) {} });
  try {
    if (where === "in front") acts[act](req, res);
    line = call === "end" ? (res.end("k"), "returns") : "gives " + res.write("k");
  } catch (error) { line = "throws " + error.code; }
  try { if (!res.writableEnded && !res.destroyed) res.end(); } catch (error) { line += " . then " + error.code; res.destroy(); }
};
const server = http.createServer((req, res) => { if (row[1] === "later") setImmediate(answer, req, res); else answer(req, res); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const guard = setTimeout(() => { console.log("did not end by itself"); process.exit(1); }, 30000);
const cases = [["later", "second write", "strictContentLength", "response"], ["later", "end", "sendDate", "response"]];
for (const where of ["amid", "in front"]) for (const one of cases) {
  row = [where, ...one];
  try { await (await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(3000) })).text(); } catch {}
  await new Promise(resolve => setImmediate(resolve));
  console.log(row.join(" ") + ": " + line);
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
