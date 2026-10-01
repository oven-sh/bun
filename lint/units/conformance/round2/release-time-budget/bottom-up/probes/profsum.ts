// usage: bun profsum.ts <file.cpuprofile> [top]: self and total SAMPLE COUNTS by function (not the time gaps, which a loaded host stretches).
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const top = Number(process.argv[3] ?? 40);
const nodes = new Map<number, any>();
for (const n of prof.nodes) nodes.set(n.id, n);
const parent = new Map<number, number>();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n: any) => `${n.callFrame.functionName || "(anonymous)"} ${String(n.callFrame.url).replace(/^.*\/runner\//, "")}`;
const self = new Map<string, number>();
const total = new Map<string, number>();
let count = 0;
for (const id of prof.samples) {
  count++;
  const n = nodes.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + 1);
  const seen = new Set<string>();
  for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(nodes.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    total.set(k, (total.get(k) ?? 0) + 1);
  }
}
const show = (m: Map<string, number>, label: string) => {
  console.log(`-- ${label} (of ${count} samples)`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${String(v).padStart(5)} ${((100 * v) / count).toFixed(1).padStart(5)}%  ${k}`);
};
show(self, "self");
show(total, "total");
