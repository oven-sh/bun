// Sums a .cpuprofile by function: self samples and total (inclusive) samples, as shares of the samples below a root function.
import { readFileSync } from "node:fs";
const [file, rootName = "enumerateInstances", top = "45"] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = (n: any) => `${n.callFrame.functionName || "(anonymous)"} ${n.callFrame.url.replace(/^.*\//, "")}`;
const self = new Map<string, number>();
const total = new Map<string, number>();
let below = 0;
let all = 0;
for (const id of profile.samples) {
  all++;
  const stack: string[] = [];
  let inside = false;
  for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
    const n = nodes.get(cur);
    stack.push(label(n));
    if ((n.callFrame.functionName || "") === rootName) inside = true;
  }
  if (!inside) continue;
  below++;
  self.set(stack[0], (self.get(stack[0]) ?? 0) + 1);
  for (const name of new Set(stack)) total.set(name, (total.get(name) ?? 0) + 1);
}
console.log(`${all} samples, ${below} below ${rootName}`);
const pct = (n: number) => ((100 * n) / below).toFixed(1).padStart(5) + "%";
console.log("inclusive:");
for (const [name, n] of [...total].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`  ${pct(n)} ${String(n).padStart(5)}  ${name}`);
console.log("self:");
for (const [name, n] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${pct(n)} ${String(n).padStart(5)}  ${name}`);
