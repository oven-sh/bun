// Research probe: characters of instance names, siblings of C instances, directory sizes.
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync("/tmp/oe/rows.json", "utf8")) as any[];
const kind = new Map(rows.map(r => [r.name, r.tsgo ? "E" : "C"]));
const e = enumerateInstances({ casesRoot: "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases" });
const names: string[] = e.instances.map((i: any) => i.name);
const chars = new Map<string, number>();
let nonAscii = 0, needEscape = 0, longest = "";
for (const n of names) {
  if (/[^\x20-\x7e]/.test(n)) nonAscii++;
  if (/["\\]/.test(n) || JSON.stringify(n) !== `"${n}"`) needEscape++;
  if (n.length > longest.length) longest = n;
  for (const c of n) if (!/[A-Za-z0-9]/.test(c)) chars.set(c, (chars.get(c) ?? 0) + 1);
}
console.log("instances", names.length, "unique", new Set(names).size, "unique ignoring case", new Set(names.map(n => n.toLowerCase())).size);
console.log("non-ASCII names", nonAscii, "names that JSON escapes", needEscape, "longest", longest.length, longest);
console.log("characters besides letters and digits", JSON.stringify([...chars].sort((a, b) => b[1] - a[1])));
// sort orders: code unit order against locale order and against byte order of UTF-8
const a = [...names].sort();
const b = [...names].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const c = [...names].sort((x, y) => Buffer.compare(Buffer.from(x, "utf8"), Buffer.from(y, "utf8")));
const d = [...names].sort((x, y) => x.localeCompare(y));
console.log("default sort equals comparison by <:", JSON.stringify(a) === JSON.stringify(b), "equals UTF-8 byte order:", JSON.stringify(a) === JSON.stringify(c), "equals localeCompare:", JSON.stringify(a) === JSON.stringify(d));
let firstDiff = a.findIndex((x, k) => x !== d[k]);
console.log("first difference with localeCompare at", firstDiff, a[firstDiff], "|", d[firstDiff]);
// a name that is a prefix of another, and the place of '(' and '.' in the order
const ex = a.filter(n => n.startsWith("abstractProperty")).slice(0, 8);
console.log(ex);
// siblings
const byCase = new Map<string, any[]>();
for (const i of e.instances) { if (!byCase.has(i.casePath)) byCase.set(i.casePath, []); byCase.get(i.casePath)!.push(i); }
let cWithESibling = 0, cTotal = 0, eTotal = 0, casesMixed = 0, cSingle = 0, cWithOnlyCSiblings = 0;
for (const [k, v] of byCase) {
  const run = v.filter(i => i.status === "run");
  const E = run.filter(i => kind.get(i.name) === "E").length;
  const C = run.filter(i => kind.get(i.name) === "C").length;
  cTotal += C; eTotal += E;
  if (E > 0 && C > 0) { casesMixed++; cWithESibling += C; }
  else if (C === 1 && v.length === 1) cSingle++;
  else if (C > 0) cWithOnlyCSiblings += C;
}
console.log("cases", byCase.size, "E", eTotal, "C", cTotal, "cases with E and C instances", casesMixed, "C instances with an E sibling", cWithESibling, "C of a case with one instance", cSingle, "other C", cWithOnlyCSiblings);
// directories
const byDir = new Map<string, { E: number; C: number }>();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const dir = i.suite + "/" + (i.casePath.includes("/") ? i.casePath.slice(0, i.casePath.lastIndexOf("/")) : "");
  const x = byDir.get(dir) ?? { E: 0, C: 0 };
  if (kind.get(i.name) === "E") x.E++; else x.C++;
  byDir.set(dir, x);
}
console.log("directories with run instances", byDir.size, "with no E", [...byDir.values()].filter(x => x.E === 0).length, "C in directories with no E", [...byDir.values()].filter(x => x.E === 0).reduce((s, x) => s + x.C, 0));
console.log("sample casePath", e.instances[0].casePath, e.instances[9000].casePath, e.instances[9000].suite);
