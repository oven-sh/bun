// Survey: the operands that the default check hands to `bun --lint`, by extension, over every run instance of the corpus.
import { openCorpus } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner";

const corpus = openCorpus("/tmp/dcc-scratch/test/cli/lint/conformance/corpus");
const all = corpus.enumerateInstances();
const run = all.filter(i => i.status === "run");
console.log(`instances ${all.length}, run ${run.length}`);

const supported = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const extOf = (name: string) => {
  const lower = name.toLowerCase();
  for (const e of supported) if (lower.endsWith(e)) return name.slice(name.length - e.length);
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "(none)" : base.slice(dot);
};

const byExt = new Map<string, { files: number; instances: Set<string> }>();
const kinds = { E: 0, C: 0 };
let unsupportedLayout = 0;
const reasons = new Map<string, number>();
let noOperand = 0;
const instWithUnsupported = new Map<string, { kind: string; exts: string[] }>();
const shape = new Map<string, number>();
let caseSensitiveOperandExt = 0;
const out: any[] = [];
for (const i of run) {
  const built = corpus.input(i, undefined);
  if (!built.ok) {
    unsupportedLayout++;
    const r = built.reason.replace(/\/\S+/g, "<path>").slice(0, 80);
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
    continue;
  }
  kinds[i.oracle.class]++;
  const roots = built.input.rootFiles;
  if (roots.length === 0) noOperand++;
  const exts = roots.map(extOf);
  const bad: string[] = [];
  for (let k = 0; k < roots.length; k++) {
    const e = exts[k];
    let rec = byExt.get(e);
    if (rec === undefined) byExt.set(e, (rec = { files: 0, instances: new Set() }));
    rec.files++;
    rec.instances.add(i.name);
    if (!supported.includes(e)) bad.push(e);
    if (supported.includes(e.toLowerCase()) && !supported.includes(e)) caseSensitiveOperandExt++;
  }
  if (bad.length > 0) instWithUnsupported.set(i.name, { kind: i.oracle.class, exts: bad });
  // the shape of the instance for the command: only ts-like, has js-like, has d.ts only, ...
  const has = (list: string[]) => exts.some(e => list.includes(e.toLowerCase()));
  const key = [
    has([".ts", ".tsx", ".mts", ".cts"]) ? "ts" : "",
    has([".js", ".jsx", ".mjs", ".cjs"]) ? "js" : "",
    has([".d.ts", ".d.mts", ".d.cts"]) ? "dts" : "",
    bad.length > 0 ? "other" : "",
  ]
    .filter(x => x !== "")
    .join("+");
  shape.set(`${i.oracle.class} ${key || "nothing"}`, (shape.get(`${i.oracle.class} ${key || "nothing"}`) ?? 0) + 1);
  out.push({ name: i.name, kind: i.oracle.class, roots, cwd: built.input.currentDirectory });
}
console.log(`laid out: E ${kinds.E}, C ${kinds.C}; not laid out ${unsupportedLayout}; no operand ${noOperand}`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`   ${n}  ${r}`);
console.log("operands by extension: files, instances");
for (const [e, rec] of [...byExt].sort((a, b) => b[1].files - a[1].files)) {
  console.log(`  ${e.padEnd(10)} ${String(rec.files).padStart(6)} ${String(rec.instances.size).padStart(6)} ${supported.includes(e) ? "" : "UNSUPPORTED by bun --lint"}`);
}
console.log(`operands whose extension is supported only when case is ignored: ${caseSensitiveOperandExt}`);
console.log(`instances with an operand of an unsupported extension: ${instWithUnsupported.size}`);
const k = { E: 0, C: 0 };
for (const v of instWithUnsupported.values()) k[v.kind as "E" | "C"]++;
console.log(`  of class E ${k.E}, C ${k.C}`);
for (const [name, v] of [...instWithUnsupported].slice(0, 40)) console.log(`  ${v.kind} ${name}: ${v.exts.join(" ")}`);
console.log("shapes:");
for (const [s, n] of [...shape].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${s}`);
await Bun.write("/tmp/dcc/operands.json", JSON.stringify(out));
