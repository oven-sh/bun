// Joins targeted-bun.jsonl and targeted-tsc.jsonl and prints, per input, how bun's two instantiations and tsc's
// two file kinds relate. usage: bun targeted-digest.mjs [--all]
import { readFileSync } from "node:fs";
const dir = new URL("./", import.meta.url);
const read = f => readFileSync(new URL(f, dir), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const bun = read("targeted-bun.jsonl"), tsc = new Map(read("targeted-tsc.jsonl").map(r => [r.group + "\0" + r.src, r]));
const all = process.argv.includes("--all");
const one = s => s.replace(/\s+/g, " ");
const codes = l => l.map(d => "TS" + d.code).join(",") || "-";
const summary = {};
const note = (g, k) => { (summary[g] ||= {})[k] = ((summary[g] ||= {})[k] || 0) + 1; };
for (const b of bun) {
  const t = tsc.get(b.group + "\0" + b.src);
  const jsxGroup = b.group === "jsx";
  const [J, T, tj, tt] = jsxGroup ? [b.jsx, b.tsx, t["a.jsx"], t["a.tsx"]] : [b.js, b.ts, t["a.js"], t["a.ts"]];
  let rel;
  if (J.ok && T.ok) rel = J.out === T.out ? "same" : "DIFFERENT OUTPUT";
  else if (J.ok && !T.ok) rel = "TS REJECTS";
  else if (!J.ok && T.ok) rel = "ts-only";
  else rel = "both reject";
  const tscJs = tj.parse.length ? "parse " + codes(tj.parse) : tj.js.length ? "js " + codes(tj.js) : "clean";
  const tscShape = tj.shape === tt.shape ? "shape=" : "shape!=";
  const kinds = ["a.js", "a.jsx", "a.mjs", "a.cjs"].map(n => t[n].shape + "|" + codes(t[n].parse) + "|" + codes(t[n].js));
  const uniform = new Set(kinds).size === 1 ? "" : " JS-KINDS-DIFFER";
  note(b.group, `bun ${jsxGroup ? "jsx/tsx" : "js/ts"}: ${rel}`);
  note(b.group, `tsc ${jsxGroup ? ".jsx" : ".js"}: ${tj.parse.length ? "parse error" : tj.js.length ? "TS8xxx" : "clean"}${rel === "same" || rel === "both reject" ? "" : " [" + rel + "]"}`);
  if (all || rel !== "same" || uniform) {
    console.log(`[${b.group}] ${JSON.stringify(b.src)}\n    bun: ${rel}${J.ok ? "" : "  js: " + J.errors[0]}${T.ok ? "" : "  ts: " + T.errors[0]}`);
    if (rel === "DIFFERENT OUTPUT") console.log(`      js: ${one(J.out)}\n      ts: ${one(T.out)}`);
    console.log(`    tsc ${jsxGroup ? ".jsx" : ".js"}: ${tscJs}; ${jsxGroup ? ".tsx" : ".ts"}: ${tt.parse.length ? "parse " + codes(tt.parse) : "clean"}; ${tscShape}${uniform}`);
  }
}
console.log("\nSUMMARY");
for (const [g, m] of Object.entries(summary)) { console.log(g); for (const k of Object.keys(m).sort()) console.log("  ", String(m[k]).padStart(4), k); }
