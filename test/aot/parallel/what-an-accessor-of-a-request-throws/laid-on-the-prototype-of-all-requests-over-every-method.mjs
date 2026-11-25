// An accessor of the program's over each of the ten methods that a request calls on itself, laid on the prototype of all requests in four ways: how often it is asked, what is called, and where what it throws goes.
import http from "node:http";
const holder = http.IncomingMessage.prototype;
const names = ["emit", "_dump", "removeAllListeners", "resume", "read", "_read", "push", "destroy", "_destroy", "listenerCount"];
const ways = ["the library's own", "a wrapper", "another at the second read", "throws once"];
let row = null, log = [], line = "", undo = null;
process.on("uncaughtException", error => { line += " . uncaught " + error.message; });
function lay(name, way) {
  const before = Object.getOwnPropertyDescriptor(holder, name), original = holder[name]; let reads = 0;
  const other = function (...rest) { log.push("call"); return Reflect.apply(original, this, rest); };
  undo = () => { if (before) Object.defineProperty(holder, name, before); else delete holder[name]; };
  Object.defineProperty(holder, name, { configurable: true, enumerable: true, set() {}, get() { log.push("get"); reads++;
    if (way === "throws once" && reads === 1) throw new Error("made up");
    return way === "a wrapper" || (way === "another at the second read" && reads > 1) ? other : original; } });
}
const server = http.createServer((req, res) => { res.end("k"); if (row !== null) lay(row[0], row[1]); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const ask = async () => { try { return await (await fetch(url, { signal: AbortSignal.timeout(3000) })).text(); } catch { return "no body"; } };
const rest = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
for (const name of names) for (const way of ways) {
  row = null; undo = null; await ask(); await rest();
  row = [name, way]; log = []; line = "";
  const seen = await ask(); await rest();
  const shown = name + " . " + way + ": " + seen + line + " | " + log.join(" ");
  undo?.(); row = null; console.log(shown);
  server.closeAllConnections(); await rest();
}
await new Promise(resolve => server.close(resolve));
