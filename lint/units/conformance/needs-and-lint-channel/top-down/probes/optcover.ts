import { readFileSync } from "node:fs";
const decls = JSON.parse(readFileSync("/workspace/notes/lint/units/conformance/enumerator-topdown/prototype/decls.json", "utf8")) as any[];
const declared = new Map<string, any>();
for (const d of decls) declared.set(d.name.toLowerCase(), d);
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const run = rows.filter(r => r.status === "run");
const harnessOnly = new Map<string, number>();
const optFreq = new Map<string, number>();
let withDeclared = 0;
const perInst: { kind: string; opts: string[] }[] = [];
for (const r of run) {
  const c = r.configuration ? JSON.parse(r.configuration) : {};
  const opts: string[] = [];
  for (const k of Object.keys(c)) {
    if (declared.has(k)) { opts.push(k); optFreq.set(k, (optFreq.get(k) ?? 0) + 1); }
    else harnessOnly.set(k, (harnessOnly.get(k) ?? 0) + 1);
  }
  if (opts.length) withDeclared++;
  perInst.push({ kind: r.kind, opts });
}
console.log("run", run.length, "with a declared compiler option", withDeclared);
console.log("not declared (harness directives):", [...harnessOnly].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
console.log("declared option names in use:", optFreq.size, "of", declared.size, "declared names");
const order = [...optFreq].sort((a, b) => b[1] - a[1]).map(x => x[0]);
const have = new Set<string>();
let out: string[] = [];
for (let i = 0; i < order.length; i++) {
  have.add(order[i]);
  let n = 0, e = 0, c = 0;
  for (const p of perInst) if (p.opts.every(o => have.has(o))) { n++; if (p.kind === "E") e++; else c++; }
  if (i < 12 || (i + 1) % 10 === 0 || i === order.length - 1) out.push(`${i + 1}\t${order[i]}\t${optFreq.get(order[i])}\t${n}\tE=${e}\tC=${c}`);
}
console.log("k\tk-th option\tuses\tinstances whose options are all within the first k");
console.log(out.join("\n"));
const kinds = new Map<string, number>();
for (const k of order) { const d = declared.get(k); kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1); }
console.log("kinds of the declared options in use:", JSON.stringify([...kinds]));
const affects = new Map<string, number>();
for (const k of order) for (const a of declared.get(k).affects ?? []) affects.set(a, (affects.get(a) ?? 0) + 1);
console.log("affects:", JSON.stringify([...affects]));
