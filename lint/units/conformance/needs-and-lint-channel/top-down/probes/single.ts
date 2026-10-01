import { readFileSync } from "node:fs";
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const kind = new Map(rows.filter(r => r.status === "run").map(r => [r.suite + "/" + r.name, r]));
const split = readFileSync("split.tsv", "utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const nm = readFileSync("/workspace/notes/lint/units/conformance/instance-materialisation/top-down/vectors/not-materialisable.tsv", "utf8").split("\n").slice(1).map(l => l.split("\t"));
const notLinux = new Set(nm.filter(x => x[2] === "run" && x[4] === "linux").map(x => x[0] + "/" + x[1]));
const count = () => ({ n: 0, E: 0, C: 0 });
const c = { all: count(), single: count(), singleMaterialisable: count(), singleTs: count(), singleTsNoJsx: count(), multi: count(), config: count(), notMaterialisableLinux: count() };
const add = (k: keyof typeof c, r: any) => { c[k].n++; (c[k] as any)[r.kind]++; };
for (const s of split) {
  const key = s[0] + "/" + s[1];
  const r = kind.get(key);
  if (!r) continue;
  add("all", r);
  const roots = (s[5] ?? "").split("|").filter(Boolean), others = (s[6] ?? "").split("|").filter(Boolean);
  const bad = notLinux.has(key);
  if (bad) add("notMaterialisableLinux", r);
  if (s[4]) add("config", r);
  if (roots.length === 1 && others.length === 0 && !s[4]) {
    add("single", r);
    if (!bad) {
      add("singleMaterialisable", r);
      if (/\.(ts|tsx|mts|cts)$/.test(roots[0])) {
        add("singleTs", r);
        if (!/\.tsx$/.test(roots[0])) add("singleTsNoJsx", r);
      }
    }
  } else add("multi", r);
}
console.log(JSON.stringify(c));
