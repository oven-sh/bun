// usage: bun spawn_conc.ts <binary> <count> <concurrency...>
const [bin, countText, ...concs] = process.argv.slice(2);
const count = Number(countText);
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" } as Record<string, string>;
delete env.BUN_OPTIONS;
async function one(): Promise<number> {
  const t = performance.now();
  const p = Bun.spawn({ cmd: [bin, "--revision"], env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  return performance.now() - t;
}
for (const cText of concs) {
  const c = Number(cText);
  let next = 0; const times: number[] = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: c }, async () => { while (next++ < count) times.push(await one()); }));
  const wall = performance.now() - t0;
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ bin: bin.split("/").slice(-3).join("/"), count, concurrency: c, wallMs: Math.round(wall), perInstanceWallMs: +(wall / count).toFixed(1), medianMs: +times[times.length >> 1].toFixed(1), maxMs: Math.round(times[times.length - 1]) }));
}
