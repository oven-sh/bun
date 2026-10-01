const exe = process.execPath;
async function one(args: string[]) {
  const p = Bun.spawn({ cmd: [exe, ...args], stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
  const [o, e, c] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  return c;
}
for (const [label, args] of [["--version", ["--version"]], ["empty.ts", ["/tmp/lint-conformance-empty.ts"]]] as const) {
  await Bun.write("/tmp/lint-conformance-empty.ts", "export {};\n");
  let t = performance.now();
  for (let i = 0; i < 50; i++) await one([...args]);
  const serial = (performance.now() - t) / 50;
  t = performance.now();
  const N = 400, width = 16;
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < N) { next++; await one([...args]); } }));
  const par = (performance.now() - t);
  console.log(label, "serial ms/spawn", serial.toFixed(2), "| 400 spawns at width 16: total ms", par.toFixed(0), "=> per instance", (par / N).toFixed(2));
}
