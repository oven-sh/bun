import { readFileSync } from "node:fs";
const decls = JSON.parse(readFileSync("/workspace/notes/lint/units/conformance/enumerator-topdown/prototype/decls.json", "utf8")) as any[];
const declared = new Set(decls.map(d => d.name.toLowerCase()));
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
for (const r of rows) {
  if (r.status !== "run") continue;
  const c = r.configuration ? JSON.parse(r.configuration) : {};
  if (!Object.keys(c).some(k => declared.has(k))) console.log(r.kind, r.suite + "/" + r.name, r.configuration);
}
