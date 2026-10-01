// bun classify.mjs : every record with the mark !! or ?? of the three diffs, given to a fix (X..) or to a class that needs a ruling (L.., M.., V..)
import { readFileSync, writeFileSync } from "node:fs";
const O = "/tmp/gdr1b/out";
const UNARY = /^\s*(\+|-[a-z]|!|~|delete |void |typeof |await |<B>\[)/;
function fixOf(d) {
  const t = d.t ?? d.src, ctx = d.ctx, c = d.cause, her = ctx === "heritage" || ctx === "iextends";
  if (c.startsWith("ruling: metadata of a source")) return "M-ruling  metadata of a source that tsc does not parse";
  if (c.startsWith("FORBIDDEN metadata")) return "X12  a branch of a conditional type names a class of the file";
  if (c.startsWith("ruling: A>A a declaration named") || c.startsWith("ruling: cast after a declaration named as")) return "V-ruling  a declaration named as or satisfies, where the base read a cast (A>A is tsc's program, R>A has the base cast behind it)";
  if (c.startsWith("ruling: attributes of an export")) return "V-ruling  export attributes on the next line (ECMAScript allows, tsc rejects)";
  if (c.startsWith("ruling: attributes of a type-only import")) return "L7  import type with attributes (TS2857), which the base takes on one line";
  if (c.startsWith("ruling: tsc reports a rule of syntax")) return "V-ruling  [delete A] as a heritage entry: TS1102 of the binder, no parse diagnostic, no grammar error";
  if (ctx == null) {
    // whole programs
    if (/accessor/.test(t)) return "L4  accessor with experimentalDecorators + a modifier laxness the base has with standard decorators";
    if (/^class C \{ \[k: string/.test(t)) return "X10  class index signature";
    if (/^interface I (extends|implements)/.test(t)) return "X2  interface heritage clauses";
    if (/^function f\((readonly|override|public) /.test(t)) return "X4  modifiers of a parameter of a function";
    if (/#a/.test(t) && /\{ #a/.test(t)) return "X5  type member";
    if (/#a|super\.A/.test(t)) return /super/.test(t) ? "X8  constraint of a type parameter" : "X7  private name or .< in a type reference";
    if (/\.</.test(t)) return "X7  private name or .< in a type reference";
    if (/class \{\}/.test(t)) return "L5  top-level return after a function whose return type is a reserved word";
    if (/\{ (\[|1n|a\??: A =|get a)/.test(t) || /\{ \[/.test(t)) return "X5  type member";
    if (/\((\.\.\.|a\?|\{ \.\.\.|readonly|override|public)/.test(t)) return "X3  parameters of a signature";
    if (/^import A from/.test(t)) return "L8  with ( after a module path: the second statement alone is accepted by the base";
    return "??unassigned whole program";
  }
  if (ctx === "tparam" && /^( in| delete| class|super|super\.a)$/.test(t)) return "X8  constraint of a type parameter";
  if (ctx === "tparam" && t === "#a") return "X7  private name or .< in a type reference";
  if (ctx === "targ" && t === " extends") return "X9  extends at the start of a type argument";
  if (ctx === "field" && /\n\[\]$/.test(t)) return "X10  class index signature";
  if (t === "class {}" && ctx === "fnret") return "L5  top-level return after a function whose return type is a reserved word";
  if (/^\[a\??: (A)?\?\]$/.test(t)) return "X6  ? after the type of a named tuple element";
  if (/^\{ #a:/.test(t) || /^\{ (1n|a: A =)/.test(t)) return "X5  type member";
  if (/^\{ (readonly )?\[/.test(t) && !/\[K in/.test(t)) return "X5  type member";
  if (/^\(a\?: A = 1\) =>/.test(t)) return "X3  parameters of a signature";
  if (/\.</.test(t) && !/^import/.test(t)) return "X7  private name or .< in a type reference";
  if (t === "#a") return "X7  private name or .< in a type reference";
  if (ctx === "iextends" && (/^(A| U|infer ) extends/.test(t) || t === "" || /^A extends\s*$/.test(t))) return "X2  interface heritage clauses";
  if (!her && /=>\s*$/.test(t)) return (ctx === "ret" || ctx === "fnret") ? "L2  a function type without a return type before the body: the base reads { return x; } as its return type" : "L3  a type that is missing inside an attempt";
  if (her && UNARY.test(t)) return "X1  heritage entry: an expression that starts no LeftHandSideExpression";
  if (her && /^A<>\.C$/.test(t)) return "L6  A<>.C as a heritage entry: the base takes it as an expression (TS1477, TS1099)";
  if (her) return "L1  heritage entry read as a type, as before: a type form that is newly accepted as a type";
  return "??unassigned " + ctx;
}
const rows = new Map();
const detail = [];
for (const corpus of ["small", "targeted", "testrows"]) {
  for (const line of readFileSync(`${O}/diff.${corpus}.jsonl`, "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (!/^(RESTORE|FORBIDDEN|ruling|NO ORACLE|unexplained)/.test(d.cause) && /^(R>A|A>A|R>R)$/.test(d.cls)) continue;
    const fix = fixOf(d);
    const key = fix;
    if (!rows.has(key)) rows.set(key, { recs: { small: 0, targeted: 0, testrows: 0 }, srcs: { small: new Set(), targeted: new Set(), testrows: new Set() }, codes: new Set(), ex: new Set() });
    const r = rows.get(key);
    r.recs[corpus]++; r.srcs[corpus].add(d.src);
    const m = /TS\d+/.exec(d.cause); if (m) r.codes.add(m[0]);
    if (r.ex.size < 3) r.ex.add(d.src);
    detail.push({ fix: fix.split("  ")[0], corpus, cls: d.cls, cause: d.cause, api: d.api, ctx: d.ctx, t: d.t, src: d.src });
  }
}
let tr = 0, ts = 0;
for (const [key, r] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const recs = r.recs.small + r.recs.targeted + r.recs.testrows, srcs = r.srcs.small.size + r.srcs.targeted.size + r.srcs.testrows.size;
  tr += recs; ts += srcs;
  console.log(`${key}\n     records ${recs} (small ${r.recs.small}, targeted ${r.recs.targeted}, testrows ${r.recs.testrows}); sources ${srcs} (${r.srcs.small.size}, ${r.srcs.targeted.size}, ${r.srcs.testrows.size}); tsc: ${[...r.codes].sort().join(" ") || "-"}\n     e.g. ${[...r.ex].map(s => JSON.stringify(s)).join("  ")}`);
}
console.log(`total ${tr} records, ${ts} sources`);
writeFileSync(`${O}/marked.jsonl`, detail.map(x => JSON.stringify(x)).join("\n") + "\n");
