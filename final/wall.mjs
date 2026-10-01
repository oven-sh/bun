// Interleaved wall-clock of `<binary> <script>`: bun wall.mjs <N> <script> <binaryA> <binaryB> [...]
const [n, script, ...bins] = process.argv.slice(2);
const N = Number(n);
const times = bins.map(() => []);
const env = { PATH: process.env.PATH, HOME: process.env.HOME ?? "/root", NO_COLOR: "1" };
for (let i = 0; i < N + 5; i++) {
  for (let b = 0; b < bins.length; b++) {
    const k = (b + i) % bins.length; // rotate the order
    const t0 = Bun.nanoseconds();
    const r = Bun.spawnSync({ cmd: [bins[k], script], env, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    const t1 = Bun.nanoseconds();
    if (r.exitCode !== 0) throw new Error(bins[k] + " exit " + r.exitCode);
    if (i >= 5) times[k].push((t1 - t0) / 1e3);
  }
}
const stat = a => {
  a.sort((x, y) => x - y);
  const q = p => a[Math.floor((a.length - 1) * p)];
  return { min: a[0], p25: q(0.25), median: q(0.5), p75: q(0.75) };
};
for (let b = 0; b < bins.length; b++) {
  const s = stat(times[b]);
  console.log(`${bins[b].split("/").pop().padEnd(32)} min ${s.min.toFixed(0)}  p25 ${s.p25.toFixed(0)}  median ${s.median.toFixed(0)}  p75 ${s.p75.toFixed(0)}  (µs, n=${times[b].length})`);
}
