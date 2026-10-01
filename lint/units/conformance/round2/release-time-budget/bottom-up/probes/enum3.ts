// usage: bun enum3.ts <repo> [n]
const repo = process.argv[2];
const n = Number(process.argv[3] ?? 3);
const H = `${repo}/test/cli/lint/conformance`;
const t00 = performance.now();
const c00 = process.cpuUsage();
const { enumerateInstances } = await import(`${H}/runner/compiler_runner.ts`);
const c01 = process.cpuUsage(c00);
console.log(`import: wall ${(performance.now() - t00).toFixed(0)} ms, user ${(c01.user / 1000).toFixed(0)} ms, sys ${(c01.system / 1000).toFixed(0)} ms`);
for (let k = 0; k < n; k++) {
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  const instances = enumerateInstances(`${H}/corpus/cases`);
  const c = process.cpuUsage(c0);
  const wall = performance.now() - t0;
  const by: Record<string, number> = {};
  for (const i of instances) by[i.status] = (by[i.status] ?? 0) + 1;
  console.log(`call ${k + 1}: wall ${wall.toFixed(0)} ms, user ${(c.user / 1000).toFixed(0)} ms, sys ${(c.system / 1000).toFixed(0)} ms, instances ${instances.length} ${JSON.stringify(by)}`);
}
