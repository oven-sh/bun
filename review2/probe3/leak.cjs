// N children per shape, then GC; report surviving objects of the stream/child classes and RSS.
const { spawn } = require("child_process");
const { heapStats } = require("bun:jsc");
const shape = process.argv[2], N = +process.argv[3] || 300;
process.on("uncaughtException", () => {});
function one() {
  return new Promise(resolve => {
    const script = shape === "never-ends" ? "printf x; exec sleep 30" : "head -c 300000 /dev/zero; printf e >&2";
    const c = spawn("sh", ["-c", script]);
    let n = 0;
    if (shape === "unread") { /* nothing */ }
    else if (shape === "data") { c.stdout.on("data", () => {}); c.stderr.on("data", () => {}); }
    else if (shape === "destroy") c.stdout.on("data", () => { c.stdout.destroy(); });
    else if (shape === "kill") c.stdout.on("data", () => { if (++n === 1) c.kill("SIGKILL"); });
    else if (shape === "throw") c.stdout.on("data", () => { if (++n === 1) throw new Error("boom"); });
    else if (shape === "never-ends") { c.stdout.on("data", () => { c.stdout.destroy(); c.stderr.destroy(); c.kill("SIGKILL"); }); }
    else if (shape === "unread-kill") { setImmediate(() => c.kill("SIGKILL")); }
    c.on("close", resolve);
  });
}
(async () => {
  for (let i = 0; i < N; i += 10) await Promise.all(Array.from({ length: 10 }, one));
  for (let i = 0; i < 5; i++) { Bun.gc(true); await new Promise(r => setTimeout(r, 20)); }
  const t = heapStats().objectTypeCounts; const pick = {};
  for (const k of Object.keys(t)) if (/Source|Readable|Subprocess|ChildProcess|FileSink|Writable|Buffer$|Uint8Array/.test(k)) pick[k] = t[k];
  console.log(shape, JSON.stringify(pick), "rss_mb", Math.round(process.memoryUsage().rss / 1048576));
})();
