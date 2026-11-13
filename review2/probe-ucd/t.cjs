// Throughput with an 'uncaughtException' handler: a gapless writer and a listener that throws on every chunk (or never).
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const mib = Number(process.argv[3] || 256);
let uncaught = 0;
process.on("uncaughtException", () => { uncaught++; });
const t0 = process.hrtime.bigint();
const c = spawn("head", ["-c", String(mib * 1024 * 1024), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0;
c.stdout.on("data", d => { n++; bytes += d.length; if (mode === "throw") throw new Error("boom"); });
c.on("close", () => {
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(JSON.stringify({ mode, mib, chunks: n, bytes, uncaught, ms: Math.round(ms), avgChunk: Math.round(bytes / n) }));
});
