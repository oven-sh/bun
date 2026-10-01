// The Rust sink (rs/scratch) against tsc 6.0.2 (loose), on random forms, with one transpile for all of them.
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
import { metadataCalls, tagOf } from "/workspace/notes/lint/units/parser/probes/metadata.mjs";
import { spawnSync } from "node:child_process";
let seed = Number(process.argv[2] ?? 1); const N = Number(process.argv[3] ?? 3000); const depth = Number(process.argv[4] ?? 4);
const rnd = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const atoms = ["string", "number", "never", "unknown", "any", "null", "undefined", "void", "K", "L", "A.B", "K[]", "fn", "imp", "uniq", "obj", "tup", "tpl", "s", "1", "true", "boolean", "object", "this", "keyof K", "typeof a", "K[L]", "readonly K[]", "Object", "symbol", "bigint", "never[]", "A.B.C"];
const TS = { fn: "(() => void)", imp: 'import("x")', uniq: "unique symbol", obj: "{}", tup: "[K]", tpl: "`a${K}`", s: '"s"' };
const toTs = f => f.replace(/\b(fn|imp|uniq|obj|tup|tpl|s)\b/g, m => TS[m]);
function gen(d) {
  const r = d <= 0 ? 0 : rnd(10);
  if (r < 3) return atoms[rnd(atoms.length)];
  if (r < 5) return gen(d - 1) + " | " + gen(d - 1);
  if (r < 7) return gen(d - 1) + " & " + gen(d - 1);
  if (r < 8) return "(" + gen(d - 1) + ")";
  // a conditional type is no check type and no extends type without parentheses
  const whole = t => (t.includes(" extends ") ? `(${t})` : t);
  return whole(gen(d - 1)) + " extends " + whole(gen(d - 1)) + " ? " + gen(d - 1) + " : " + gen(d - 1);
}
const forms = new Set();
while (forms.size < N) forms.add(gen(depth));
const list = [...forms];
const r = spawnSync(process.env.SINK ?? "/tmp/p1-3-sink/scratch", { input: list.join("\n") + "\n", maxBuffer: 1 << 28 });
if (r.status !== 0) { console.log("scratch failed", r.stderr.toString().slice(0, 2000)); process.exit(1); }
const rust = r.stdout.toString().split("\n").filter(Boolean).map(l => l.split("\t")[1]);
const src = list.map((f, i) => `class C${i} { @d p: ${toTs(f)}; }`).join("\n");
const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.ESNext);
if (sf.parseDiagnostics.length) { console.log("parse errors", sf.parseDiagnostics.length, ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " "), src.slice(sf.parseDiagnostics[0].start - 40, sf.parseDiagnostics[0].start + 40)); process.exit(1); }
const out = ts.transpileModule(src, { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, strict: false, strictNullChecks: false, target: ts.ScriptTarget.ESNext } }).outputText;
const calls = metadataCalls(out).filter(c => c[0] === "design:type");
if (calls.length !== list.length) { console.log("count mismatch", calls.length, list.length); process.exit(1); }
// A reference named Object is decided on its name here and on its symbol by tsc: those forms are counted apart.
let eq = 0, bad = [], objectNamed = 0;
list.forEach((f, i) => {
  const t = tagOf(calls[i][1]);
  if (t === rust[i]) eq++;
  else if (/\bObject\b/.test(f)) objectNamed++;
  else bad.push([f, rust[i], t]);
});
console.log({ seed: process.argv[2], forms: list.length, eq, objectNamed, bad: bad.length });
for (const b of bad.slice(0, 40)) console.log(b.join("\t"));
