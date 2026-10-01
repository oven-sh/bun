// usage: bun percpu-show.ts <percpu.json> [min main cpu ms]
import { readFileSync } from "node:fs";
const rows: any[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const min = Number(process.argv[3] ?? 15);
const group = (name: string) => name.replace(/: group \d+$/, ": group *").replace(/: batch \d+$/, ": batch *");
const by = new Map<string, any>();
for (const r of rows) {
  const g = group(r.name);
  const a = by.get(g) ?? { n: 0, wall: 0, mainOnCpu: 0, mainRunq: 0, mainBlocked: 0, procUser: 0, procSys: 0 };
  a.n++;
  for (const k of ["wall", "mainOnCpu", "mainRunq", "mainBlocked", "procUser", "procSys"]) a[k] += r[k];
  by.set(g, a);
}
console.log("   n   wall  mainCPU  runq blocked  procCPU(user+sys)  name");
let sum = 0;
for (const [g, a] of by) {
  if (!g.startsWith("(")) sum += a.mainOnCpu;
  if (a.mainOnCpu < min && !g.startsWith("(")) continue;
  console.log(`${String(a.n).padStart(4)} ${String(a.wall).padStart(6)} ${String(a.mainOnCpu).padStart(8)} ${String(a.mainRunq).padStart(5)} ${String(a.mainBlocked).padStart(7)} ${String(a.procUser + a.procSys).padStart(8)}           ${g.slice(0, 150)}`);
}
console.log(`sum of main-thread CPU over the tests: ${sum} ms`);
