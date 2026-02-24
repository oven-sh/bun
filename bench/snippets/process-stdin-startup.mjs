// Measures the startup cost of accessing process.stdin
// Each iteration spawns a fresh subprocess to avoid module cache effects.
import { spawnSync } from "bun";

const BUN = process.execPath;
const N = 50;

function measure(label, code) {
  const times = [];
  for (let i = 0; i < N; i++) {
    const result = spawnSync({
      cmd: [BUN, "-e", code],
      stdout: "pipe",
      stderr: "pipe",
    });
    const t = parseFloat(new TextDecoder().decode(result.stdout));
    if (!isNaN(t)) times.push(t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    `${label.padEnd(30)} median=${median.toFixed(3)}ms  mean=${mean.toFixed(3)}ms  min=${min.toFixed(3)}ms  max=${max.toFixed(3)}ms  p95=${p95.toFixed(3)}ms  (n=${times.length})`,
  );
}

console.log(`Bun: ${BUN}`);
console.log(`Iterations: ${N}\n`);

// Baseline: empty script (process startup overhead only)
measure("baseline (empty)", `process.stdout.write(String(0))`);

// Access process.stdin which triggers internal/fs/streams + node:stream loading
measure("process.stdin", `const t=performance.now();process.stdin;process.stdout.write(String(performance.now()-t))`);

// Also measure require("node:stream") directly
measure(
  "require('node:stream')",
  `const t=performance.now();require('node:stream');process.stdout.write(String(performance.now()-t))`,
);

// Measure just require("node:fs").createReadStream (also loads internal/fs/streams)
measure(
  "fs.createReadStream",
  `const t=performance.now();require('node:fs').createReadStream;process.stdout.write(String(performance.now()-t))`,
);
