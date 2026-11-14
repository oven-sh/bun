import { test } from "bun:test";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
let hits = 0;
const said = [];
const note = (label, f) => { let a; try { a = f(); } catch (e) { a = e.constructor.name; } said.push(label + "=" + a + "/" + hits); };
async function turn(label) {
  note(label + ".born", () => { const r = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 }); return [Object.hasOwn(r, "_events"), typeof r["_events"], r.statusCode, r.finished].join(","); });
  note(label + ".emitter", () => { const e = new EventEmitter(); let n = 0; e.on("x", () => n++); e.emit("x"); return n + "," + Object.hasOwn(e, "_events"); });
  note(label + ".readable", () => { const r = new Readable({ read() {} }); r.push("ab"); return String(r.read()) + "," + r.readableLength + "," + Object.hasOwn(r, "_events"); });
  note(label + ".writable", () => { let got = ""; const w = new Writable({ write(c, e, cb) { got += c; cb(); } }); w.write("cd"); return got + "," + w.writableLength; });
  let answer;
  try {
    answer = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { res.setHeader("x-a", "1"); res.end("ok:" + req.url + ":" + typeof req["_events"] + ":" + typeof res["_events"]); });
      server.on("error", reject);
      server.listen(0, () => {
        fetch("http://127.0.0.1:" + server.address().port + "/p").then(r => r.text().then(t => { server.close(); resolve(r.status + "," + r.headers.get("x-a") + "," + t); }), e => { server.close(); reject(e); });
      });
    });
  } catch (e) { answer = e.constructor.name + ":" + e.message.slice(0, 30); }
  said.push(label + ".server=" + answer + "/" + (hits > 0));
}
test("row", async () => {
  Object.defineProperty(Object.prototype, "_events", { get() { hits++; return undefined; }, set(v) { hits++; Object.defineProperty(this, "_events", { value: v, writable: true, configurable: true, enumerable: true }); }, configurable: true });
  await turn("a");
  
  
  await turn("b");
  delete Object.prototype["_events"];
  await turn("c");
  console.log("SAID " + said.join(" "));
}, 40000);
