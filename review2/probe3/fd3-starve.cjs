// Same as starve2.cjs but the child writes to fd 3 (a net.Socket over the fd in Bun and Node).
const { spawn } = require("child_process");
const SIZE = +process.env.SIZE || 60000000, WORK = +process.env.WORK || 10;
const c = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero >&3`], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
let ticks = 0, chunks = 0, maxGap = 0, last = Date.now(), first = 0, lastData = 0, maxChunk = 0;
const iv = setInterval(() => { const now = Date.now(); if (first) maxGap = Math.max(maxGap, now - last); last = now; ticks++; }, 5);
c.stdio[3].on("data", d => {
  if (!first) { first = Date.now(); last = first; }
  chunks++; maxChunk = Math.max(maxChunk, d.length);
  const until = performance.now() + WORK; while (performance.now() < until) {}
  lastData = Date.now();
});
c.on("close", () => { clearInterval(iv); console.log(JSON.stringify({ ctor: c.stdio[3].constructor.name, chunks, maxChunk, stream_ms: lastData - first, interval_ticks_5ms: ticks, longest_timer_gap_ms: maxGap })); process.exit(0); });
