// For every targeted input that bun's JavaScript instantiation accepts: is bun's TypeScript instantiation the same,
// and if not, why. Writes js-lint-expect.json: what a lint parse of the input as a JavaScript file has to give.
// usage: bun targeted-causes.mjs
import { readFileSync, writeFileSync } from "node:fs";
const read = f => readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const bun = read("./targeted-bun.jsonl"), tsc = read("./targeted-tsc.jsonl"), go = read("./targeted-tsgo.jsonl");
const counts = {}, byCause = {};
const bump = (k, src) => { counts[k] = (counts[k] || 0) + 1; (byCause[k] ||= []).push(src); };
const expect = [];
const diag = l => l.map(d => ({ code: d.code, start: d.start, length: d.length }));
for (let i = 0; i < bun.length; i++) {
  const b = bun[i], t = tsc[i], g = go[i];
  const jsx = b.group === "jsx";
  const [J, T, tj, tt, gj] = jsx ? [b.jsx, b.tsx, t["a.jsx"], t["a.tsx"], g["a.jsx"]] : [b.js, b.ts, t["a.js"], t["a.ts"], g["a.js"]];
  let relation, cause = null;
  if (J.ok && T.ok && J.out === T.out) relation = "same";
  else if (J.ok) {
    relation = T.ok ? "different tree" : "rejected";
    if (tj.parse.length) cause = "Q  tsc rejects the JavaScript file too (quirk of the reference grammar)";
    else if (tj.shape !== tt.shape) cause = "T  type arguments in an expression (tsc: not in a JavaScript file)";
    else cause = "P1 bun's TypeScript grammar differs from tsc's (tsc reads the .ts file as the .js file)";
  } else relation = T.ok ? "TypeScript only" : "rejected by both";
  if (J.ok) bump(relation === "same" ? "valid JavaScript: TypeScript instantiation the same" : `valid JavaScript: ${relation}: ${cause}`, b.src);
  else bump(`not JavaScript for bun: ${relation}; tsc .js ${tj.parse.length ? "parse error" : tj.js.length ? "TS8xxx, TS1206 or TS8038 only" : "clean"}`, b.src);
  const oraclesAgree = JSON.stringify(diag(tj.parse)) === JSON.stringify(diag(gj.parse)) && JSON.stringify(diag(tj.js)) === JSON.stringify(diag(gj.js));
  expect.push({
    group: b.group, src: b.src, file: jsx ? "a.jsx" : "a.js",
    bun_javascript: J.ok ? "accepts" : J.errors[0],
    bun_typescript: T.ok ? (J.ok && J.out !== T.out ? "accepts, different tree" : "accepts") : T.errors[0],
    cause,
    tsc: { parse: diag(tj.parse), js: diag(tj.js) },
    typescript_go: oraclesAgree ? "same as tsc" : { parse: diag(gj.parse), js: diag(gj.js) },
  });
}
for (const k of Object.keys(counts).sort()) console.log(String(counts[k]).padStart(5), k);
writeFileSync(new URL("./js-lint-expect.json", import.meta.url), JSON.stringify(expect, null, 1) + "\n");
if (process.argv.includes("--list")) for (const k of Object.keys(byCause).sort()) if (/different tree|rejected: /.test(k)) { console.log("\n" + k); for (const s of byCause[k]) console.log("   " + JSON.stringify(s)); }
