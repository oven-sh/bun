// Research probe: what a quota of list C by directory would admit at most.
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync("/tmp/oe/rows.json", "utf8")) as any[];
const kind = new Map(rows.map(r => [r.name, r.tsgo ? "E" : "C"]));
const e = enumerateInstances({ casesRoot: "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases" });
const dirOf = (i: any) => i.casePath.slice(0, i.casePath.lastIndexOf("/"));
const byDir = new Map<string, { E: number; C: number }>();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const x = byDir.get(dirOf(i)) ?? { E: 0, C: 0 };
  if (kind.get(i.name) === "E") x.E++; else x.C++;
  byDir.set(dirOf(i), x);
}
let cap = 0, never = 0;
for (const x of byDir.values()) { cap += Math.min(x.E, x.C); never += Math.max(0, x.C - x.E); }
console.log("directories", byDir.size, "largest C list under the quota", cap, "C instances that the quota never admits", never);
const top = [...byDir].sort((a, b) => (b[1].E + b[1].C) - (a[1].E + a[1].C)).slice(0, 8);
console.log(top.map(([d, x]) => `${d} E=${x.E} C=${x.C}`).join("\n"));
// depth-2 grouping
console.log("casePath examples", e.instances.slice(0, 3).map((i: any) => i.casePath), e.instances.slice(-3).map((i: any) => i.casePath));
