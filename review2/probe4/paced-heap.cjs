// GC cells per paced chunk: heapStats().objectCount at the N-th chunk, with the collector off (BUN_JSC_useGC=0). ROUTE=std|fd
const { spawn } = require("node:child_process");
const N = +process.env.N || 100, route = process.env.ROUTE || "std";
const wfd = route === "std" ? 1 : 3;
const writer = `const fs=require("fs");const one=Buffer.alloc(1),b=Buffer.alloc(4096,97);for(;;){if(fs.readSync(0,one,0,1)===0)break;fs.writeSync(${wfd},b);}`;
const child = spawn(process.execPath, ["-e", writer], { stdio: route === "std" ? ["pipe", "pipe", "ignore"] : ["pipe", "ignore", "ignore", "pipe"] });
let n = 0;
const go = () => child.stdin.write("x");
const stream = route === "std" ? child.stdout : child.stdio[3];
stream.once("resume", () => setImmediate(go));
stream.on("data", chunk => {
  if (++n === N) { const s = require("bun:jsc").heapStats(); const t = s.objectTypeCounts; console.log(JSON.stringify({ n, objectCount: s.objectCount, Promise: t.Promise | 0, Function: t.Function | 0, Uint8Array: t.Uint8Array | 0, JSLexicalEnvironment: t.JSLexicalEnvironment | 0 })); child.stdin.end(); }
  else setImmediate(go);
});
