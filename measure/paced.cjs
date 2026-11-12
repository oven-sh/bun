// A paced reader for instruction, syscall and heap counts. The writer (a bun child that reads its stdin synchronously)
// writes one 4 KiB block for each byte it reads. The reader sends the next byte on a later turn, so every chunk comes
// to a stream that is waiting. env: N (chunks), FD (1|2), HOW (data|forawait), HEAP (print heapStats at the end).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const N = +process.env.N || 100;
const name = process.env.FD === "2" ? "stderr" : "stdout";
const writer = `const fs=require("fs");const one=Buffer.alloc(1),b=Buffer.alloc(4096,97);for(;;){if(fs.readSync(0,one,0,1)===0)break;fs.writeSync(${name === "stdout" ? 1 : 2},b);}`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["pipe", name === "stdout" ? "pipe" : "ignore", name === "stderr" ? "pipe" : "ignore"] });
let n = 0, bytes = 0;
const go = () => child.stdin.write("x");
function done() {
  if (process.env.HEAP) {
    const { heapStats } = require("bun:jsc");
    const s = heapStats();
    const t = s.objectTypeCounts;
    console.log(JSON.stringify({ n, objectCount: s.objectCount, Promise: t.Promise | 0, Function: t.Function | 0, JSLexicalEnvironment: t.JSLexicalEnvironment | 0, Buffer: t.Buffer | 0, Uint8Array: t.Uint8Array | 0, ArrayBuffer: t.ArrayBuffer | 0, Object: t.Object | 0, types: Object.keys(t).length, total: Object.values(t).reduce((a, b) => a + b, 0), all: t }));
  } else console.log(JSON.stringify({ n, bytes }));
  child.stdin.end();
}
const stream = child[name];
if (process.env.HOW === "forawait") {
  (async () => { setImmediate(go); for await (const chunk of stream) { bytes += chunk.length; if (++n === N) break; setImmediate(go); } done(); })();
} else {
  stream.once("resume", () => setImmediate(go));
  stream.on("data", chunk => { bytes += chunk.length; if (++n === N) done(); else setImmediate(go); });
}
