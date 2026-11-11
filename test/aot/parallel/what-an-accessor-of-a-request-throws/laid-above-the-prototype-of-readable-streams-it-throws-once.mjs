// An accessor laid above the prototype of readable streams, under a method that a request calls on itself by way of that prototype, throws the first time that it is asked.
import http from "node:http";
import { Readable } from "node:stream";
const holder = Object.getPrototypeOf(Readable.prototype), original = holder.removeAllListeners;
let acts = false, asked = 0, line = "";
process.on("uncaughtException", error => { line += " . uncaught " + error.message; });
const server = http.createServer((req, res) => { res.end("k"); if (!acts) return;
  Object.defineProperty(holder, "removeAllListeners", { configurable: true, enumerable: true, get() { if (++asked === 1) throw new Error("made up"); return original; } }); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const rest = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
await (await fetch(url)).text(); await rest();
acts = true;
const body = await (await fetch(url)).text(); await rest();
console.log(body + line + " . asked " + asked);
delete holder.removeAllListeners;
server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
