const home = process.argv[2];
const { newCompilerOptions } = await import(home + "/runner/tsconfig");
const N = 15000;
for (let round = 0; round < 4; round++) {
  const c0 = process.cpuUsage();
  let x = 0;
  for (let i = 0; i < N; i++) {
    const o: any = newCompilerOptions();
    o.target = i & 7;
    x += o.target + (o.module | 0);
  }
  const c = process.cpuUsage(c0);
  console.log(`${((c.user + c.system) / 1000).toFixed(1).padStart(7)} ms for ${N} newCompilerOptions() of ${home.split("/")[3]}`);
}
