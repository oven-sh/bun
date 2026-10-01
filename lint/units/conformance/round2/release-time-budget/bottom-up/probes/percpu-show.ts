// usage: bun percpu-show.ts <percpu.json> <log of the same run>: the rows of the preload with the names of the runner's output, by group of tests.
import { readFileSync } from "node:fs";
const rows: any[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const names = readFileSync(process.argv[3], "utf8").split("\n").filter(l => /^\((pass|fail|skip)\) /.test(l)).map(l => l.replace(/^\(\w+\) /, "").replace(/ \[[0-9.]+ms\]$/, ""));
const tests = rows.filter(r => r.name === "");
if (tests.length !== names.length) console.log(`rows ${tests.length}, names ${names.length}: the names are not matched`);
tests.forEach((r, k) => (r.name = names[k] ?? "?"));
const group = (name: string) => (name.startsWith("default check > ") ? "default check > (20 tests side by side)" : name.replace(/: group \d+$/, ": group *").replace(/^(variations|plain format|expectations|run|error baselines|directives|listed instances|expectations\.json) > .*$/, "$1 > *"));
const by = new Map<string, any>();
for (const r of rows) {
  const g = group(r.name);
  const a = by.get(g) ?? { n: 0, wall: 0, mainOnCpu: 0, mainRunq: 0, mainBlocked: 0, procUser: 0, procSys: 0 };
  a.n++;
  for (const k of ["wall", "mainOnCpu", "mainRunq", "mainBlocked", "procUser", "procSys"]) a[k] += r[k];
  by.set(g, a);
}
console.log("   n   wall  main: cpu   runq blocked | process user+sys | tests");
for (const [g, a] of by) console.log(`${String(a.n).padStart(4)} ${String(a.wall).padStart(6)} ${String(a.mainOnCpu).padStart(10)} ${String(a.mainRunq).padStart(6)} ${String(a.mainBlocked).padStart(7)} | ${String(a.procUser + a.procSys).padStart(16)} | ${g.slice(0, 130)}`);
