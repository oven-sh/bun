// A producer that never lets the pipe run dry and a 'data' listener that takes ~1 ms per chunk. Do timers and immediates get a turn while the stream flows?
const { spawn } = require("child_process");
const SIZE = +process.env.SIZE || 100 * 1024 * 1024;
const c = spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let ticks = 0, immediates = 0, chunks = 0, maxGap = 0, last = Date.now(), first = 0, lastData = 0;
const iv = setInterval(() => { const now = Date.now(); if (first) maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 5);
(function im() { immediates++; setImmediate(im); })();
c.stdout.on("data", d => {
  if (!first) { first = Date.now(); last = first; }
  chunks++;
  const until = performance.now() + (+process.env.WORK || 1); while (performance.now() < until) {}   // ~1 ms of work per chunk
  lastData = Date.now();
});
c.on("close", () => { clearInterval(iv); console.log(JSON.stringify({ chunks, stream_ms: lastData - first, interval_ticks_5ms: ticks, longest_timer_gap_ms: maxGap, immediates })); process.exit(0); });
