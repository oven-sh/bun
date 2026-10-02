// Checks gen/facts.mjs against what passes in the crate today: the cases of parse/erased_tests.rs (kept count and record lines)
// and the cases of the tests of parse/wrappers.rs (record lines) must come out of the same oracles and the same cut.
// usage: node check-facts.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const erased = require("./erased.cjs");
const wrappers = require("/workspace/notes/lint/units/parser/probes/p3-3-wrappers-and-parentheses/oracle.cjs");
const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
const cut = line => line.replace(/ keyword=\w+/, "").replace(/ default=\S+ star=\S+ items=\S+/, "").replace(/ (items=\S+|star(-as=\S+)?)(?= path=)/, "").replace(/ path=-/, "").replace(/ (members|kind|params|kept-members|stmts|ref|key|open|body|decorators|attributes)=.*$/, "");
function cases(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  const re = /Case \{\s*name: "([^"]*)",\s*path: b"([^"]*)",\s*(?:loader: Loader::(\w+),\s*)?text: b"((?:[^"\\]|\\.)*)",\s*(?:kept: (\d+),\s*)?records: &\[((?:[^\]]|\](?!,\s*\}))*)\]/g;
  for (let m; (m = re.exec(text)); ) {
    const records = [];
    const rr = /"((?:[^"\\]|\\.)*)"/g;
    for (let x; (x = rr.exec(m[5])); ) records.push(unescape(x[1]));
    out.push({ name: m[1], path: unescape(m[2]), text: unescape(m[4]), kept: m[3 + 2] === undefined ? null : Number(m[5 - 0] && m[0].match(/kept: (\d+)/)?.[1]), records });
  }
  return out;
}
let bad = 0;
const e = cases("/workspace/wt/parser/src/js_parser/parse/erased_tests.rs");
for (const c of e) {
  const r = erased.run(c.text, c.path);
  const lines = r.lines.map(cut);
  const kept = r.keptNodes.length;
  if (JSON.stringify(lines) !== JSON.stringify(c.records) || (c.kept !== null && kept !== c.kept)) {
    bad++;
    console.log("erased_tests", c.name, "kept", kept, "test", c.kept);
    lines.forEach((l, i) => { if (l !== c.records[i]) console.log("   gen: ", l, "\n   test:", c.records[i]); });
    if (lines.length !== c.records.length) console.log("   lines", lines.length, "records", c.records.length);
  }
}
const w = cases("/workspace/wt/parser/src/js_parser/parse/wrappers.rs");
for (const c of w) {
  let lines;
  try { lines = wrappers.lines(c.path, c.text).out; } catch (err) { lines = ["THROWS " + err.message]; }
  if (JSON.stringify(lines) !== JSON.stringify(c.records)) {
    bad++;
    console.log("wrappers", c.name);
    lines.forEach((l, i) => { if (l !== c.records[i]) console.log("   gen: ", l, "\n   test:", c.records[i]); });
    if (lines.length !== c.records.length) console.log("   lines", lines.length, "records", c.records.length);
  }
}
console.log(`${e.length} cases of erased_tests.rs and ${w.length} cases of wrappers.rs, ${bad} that the oracles and the cut do not reproduce`);
