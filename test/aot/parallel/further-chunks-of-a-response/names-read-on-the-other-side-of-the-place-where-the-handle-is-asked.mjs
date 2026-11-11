// Names that the short roads of write() and end() read in front of the place where they ask the native handle, and that the full roads read behind their own: an accessor there that ends or destroys. And two deeds of a header value whose toString() runs while the head is made. The same deeds in front of the call are the control.
import http from "node:http";
let row = [], line = "", armed = false;
const acts = {
  destroys: (req, res) => res.destroy(),
  ends: (req, res) => res.end("y"),
  "destroys the connection": (req, res) => req.socket.destroy(),
  "takes another head": (req, res) => { res.writeHead(201); res.statusCode = 500; },
};
const answer = (req, res) => {
  const [where, when, call, name, act] = row;
  const deed = () => { if (where === "amid" && armed) { armed = false; acts[act](req, res); } };
  res.on("error", error => { line += " . error event " + error.code; });
  res.on("finish", () => { line += " . finish"; });
  res.setHeader("Content-Length", call === "end behind a write" ? "3" : "1");
  if (name === "toString") res.setHeader("x-made-up", { toString() { deed(); return "1"; } });
  if (call === "end behind a write") res.write("ok");
  if (name !== "toString") {
    const own = res[name];
    Object.defineProperty(res, name, { configurable: true, get() { deed(); return own; }, set(value) {} });
  }
  try {
    if (where === "in front") acts[act](req, res);
    armed = true;
    line = call === "first write" ? "gives " + res.write("k") : (call === "end" ? res.end("k") : res.end(), "returns");
  } catch (error) { line = "throws " + error.code; }
  armed = false;
  try { if (!res.writableEnded && !res.destroyed) res.end(); } catch (error) { line += " . then " + error.code; res.destroy(); }
};
const server = http.createServer((req, res) => { if (row[1] === "later") setImmediate(answer, req, res); else answer(req, res); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const guard = setTimeout(() => { console.log("did not end by itself"); process.exit(1); }, 30000);
const cases = [
  ["at once", "first write", "strictContentLength", "destroys"], ["at once", "first write", "strictContentLength", "ends"], ["at once", "first write", "statusMessage", "destroys"],
  ["at once", "end behind a write", "strictContentLength", "destroys"], ["at once", "end behind a write", "strictContentLength", "ends"],
  ["later", "end", "toString", "destroys the connection"], ["at once", "end", "toString", "takes another head"],
];
for (const where of ["amid", "in front"]) for (const one of cases) {
  row = [where, ...one];
  let seen = "no answer";
  try { const got = await fetch("http://127.0.0.1:" + server.address().port, { signal: AbortSignal.timeout(3000) }); seen = got.status + " " + (await got.text()); } catch {}
  await new Promise(resolve => setImmediate(resolve));
  console.log(row.join(" ") + ": " + line + " | " + seen);
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
