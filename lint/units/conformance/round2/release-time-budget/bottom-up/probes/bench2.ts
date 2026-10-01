// usage: bun bench2.ts <runs> <label=runner directory>...: enumerateInstances in fresh processes, the runners in turn; the median and the range of each meter.
const [runsArg, ...pairs] = process.argv.slice(2);
const runs = Number(runsArg);
const casesDir = "/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases";
const rows = new Map<string, any[]>();
for (let k = 0; k < runs; k++) {
  for (const pair of pairs) {
    const [label, dir] = pair.split("=");
    const p = Bun.spawnSync({ cmd: ["bun", "/tmp/rtb1a/probes/enumjson.ts", dir, casesDir], stdout: "pipe", stderr: "inherit" });
    (rows.get(label) ?? rows.set(label, []).get(label)!).push(JSON.parse(p.stdout.toString()).call);
  }
}
for (const [label, all] of rows) {
  const col = (f: (r: any) => number) => all.map(f).sort((a, b) => a - b);
  const show = (name: string, v: number[]) => `${name} ${v[v.length >> 1]} (${v[0]}-${v[v.length - 1]})`;
  console.log(`${label}: ${runs} runs, median (least-most) in ms | ${show("wall", col(r => r.wall))} | ${show("main-thread CPU", col(r => r.mainOnCpu))} | ${show("process user+sys", col(r => r.procUser + r.procSys))} | ${show("main-thread wait for a CPU", col(r => r.mainRunq))} | disk MB most ${Math.max(...all.map(r => r.readMB))}`);
}
