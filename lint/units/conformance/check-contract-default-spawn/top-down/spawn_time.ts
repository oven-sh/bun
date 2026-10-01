// Measures the cost of one process per instance: N sequential and N concurrent spawns of a trivial script.
const exe = process.argv[2] ?? process.execPath;
const n = Number(process.argv[3] ?? 20);
await Bun.write("/tmp/ccds-facts/trivial.ts", "const x: number = 1; export {};\n");
async function one() {
  const t0 = performance.now();
  const p = Bun.spawn({ cmd: [exe, "/tmp/ccds-facts/trivial.ts"], stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
  await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  return performance.now() - t0;
}
const seq: number[] = [];
for (let i = 0; i < n; i++) seq.push(await one());
seq.sort((a, b) => a - b);
const t0 = performance.now();
const conc = await Promise.all(Array.from({ length: n }, one));
const wall = performance.now() - t0;
console.log(JSON.stringify({ exe, n, seqMedianMs: +seq[n >> 1].toFixed(1), seqMinMs: +seq[0].toFixed(1), seqMaxMs: +seq[n - 1].toFixed(1), concurrentWallMs: +wall.toFixed(1), perInstanceConcurrentMs: +(wall / n).toFixed(1) }));
