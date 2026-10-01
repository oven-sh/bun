const [exe, nStr, concStr] = process.argv.slice(2);
const n = Number(nStr), conc = Number(concStr);
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" };
const t0 = performance.now();
let next = 0;
const times: number[] = [];
async function worker() {
  while (next < n) {
    next++;
    const s = performance.now();
    const p = Bun.spawn({ cmd: [exe, "--revision"], env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    times.push(performance.now() - s);
  }
}
await Promise.all(Array.from({ length: conc }, worker));
const wall = performance.now() - t0;
times.sort((a, b) => a - b);
console.log(JSON.stringify({ exe: exe.split("/").slice(-3).join("/"), n, conc, wallMs: Math.round(wall), perInstanceWallMs: +(wall / n).toFixed(1), medianMs: +times[times.length >> 1].toFixed(1), p90Ms: +times[Math.floor(times.length * 0.9)].toFixed(1), maxMs: +times[times.length - 1].toFixed(1) }));
