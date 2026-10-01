// usage: bun bench.ts <label> <runner directory> [runs]: enumerateInstances in fresh processes, one after the other; the median and the least of each meter.
const [label, runnerDir, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 7);
const casesDir = "/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases";
const rows: any[] = [];
for (let k = 0; k < runs; k++) {
  const p = Bun.spawnSync({ cmd: ["bun", "/tmp/rtb1a/probes/enumjson.ts", runnerDir, casesDir], stdout: "pipe", stderr: "inherit" });
  rows.push(JSON.parse(p.stdout.toString()).call);
}
const col = (f: (r: any) => number) => rows.map(f).sort((a, b) => a - b);
const show = (name: string, v: number[]) => `${name} median ${v[v.length >> 1]} min ${v[0]} max ${v[v.length - 1]}`;
console.log(`${label}: ${runs} runs | ${show("wall", col(r => r.wall))} | ${show("main cpu", col(r => r.mainOnCpu))} | ${show("process user+sys", col(r => r.procUser + r.procSys))} | ${show("main runq", col(r => r.mainRunq))} | disk MB max ${Math.max(...rows.map(r => r.readMB))}`);
