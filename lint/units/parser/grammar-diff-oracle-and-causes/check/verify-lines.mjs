// Scratch, run by the base stand-in: for each candidate line: tsc parse codes, checker grammar codes, other codes, what this bun says; is it in a corpus.
import { readFileSync } from "node:fs";
import { parseCodes, grammarOf, otherOf } from "./chk-lib.mjs";
import { expand } from "/workspace/notes/lint/units/parser/grammar-diff/harness.mjs";
const G = "/workspace/notes/lint/units/parser/grammar-diff";
const have = new Set();
for (const c of ["small", "targeted"]) for (const i of expand(JSON.parse(readFileSync(`${G}/corpus.${c}.json`, "utf8")))) have.add(i.src);
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const T = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
const run = (t, src) => { try { return "A " + JSON.stringify(t.transformSync(src)).slice(0, 50); } catch (e) { const x = e?.errors?.[0] ?? e; return "R " + String(x?.message ?? x); } };
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(l => l && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n"));
for (const src of lines) {
  const p = parseCodes(src, "ts");
  const g = p.length ? [] : grammarOf(src, "ts", false);
  const o = p.length ? [] : otherOf(src, "ts", false);
  const kind = p.length ? "PARSE" : g.length ? "GRAMMAR" : "clean";
  console.log(`${kind.padEnd(7)} ${(p.length ? p : g.map(x => x[0])).join(",").padEnd(12)} other ${o.join(",").padEnd(14)} ts: ${run(T.ts, src).slice(0, 60).padEnd(60)} ${have.has(src) ? "IN-CORPUS" : ""} ${JSON.stringify(src)}`);
}
