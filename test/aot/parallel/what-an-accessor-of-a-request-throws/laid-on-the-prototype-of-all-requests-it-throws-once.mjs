// An accessor laid on the prototype of all requests behind the end of a response throws the first time that it is asked.
import http from "node:http";
const holder = http.IncomingMessage.prototype, original = holder._dump;
let acts = false, asked = 0, line = "";
process.on("uncaughtException", error => { line += " . uncaught " + error.message; });
const server = http.createServer((req, res) => { res.end("k"); if (!acts) return;
  Object.defineProperty(holder, "_dump", { configurable: true, enumerable: true, get() { if (++asked === 1) throw new Error("made up"); return original; } }); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const rest = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
await (await fetch(url)).text(); await rest();
acts = true;
const body = await (await fetch(url)).text(); await rest();
console.log(body + line + " . asked " + asked);
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
