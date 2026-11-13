const { spawn } = require("node:child_process");
const { heapStats } = require("bun:jsc");
const N = +process.env.N || 1500, mode = process.argv[2] || "untouched";
let i = 0;
function next() {
  if (i++ === N) return done();
  const c = spawn("sh", ["-c", "printf out; printf err >&2"], { stdio: ["ignore", "pipe", "pipe"] });
  if (mode === "data") { c.stdout.on("data", () => {}); c.stderr.on("data", () => {}); }
  if (mode === "throw") { c.stdout.on("data", () => { throw new Error("x"); }); }
  if (mode === "destroy") { c.stdout.on("data", () => c.stdout.destroy()); }
  if (mode === "kill") { c.kill(); }
  c.on("close", next);
}
if (mode === "throw") process.on("uncaughtException", () => {});
async function done() {
  for (let k = 0; k < 5; k++) { Bun.gc(true); await new Promise(r => setTimeout(r, 20)); }
  const t = heapStats().objectTypeCounts;
  const pick = {}; for (const k of Object.keys(t)) if (/Readable|ChildProcess|Subprocess|FileInternalReadableStreamSource|ReadableStream|Buffer|Uint8Array|AsyncContextFrame|Function$/.test(k)) pick[k] = t[k];
  console.log(mode, JSON.stringify(pick), "rssMB=" + Math.round(process.memoryUsage().rss / 1048576));
}
next();
