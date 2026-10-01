// Derives the compact fixtures of the port of regexpp from upstream's own baselines (test/fixtures of the pinned checkout).
// usage: node make-fixtures.cjs <out dir> [--regexpp /workspace/ref/regexpp]
// Writes <out>/literal.txt and <out>/visitor.txt. One case per line, fields separated by a tab:
//   literal.txt  A <ecmaVersion> <strict 0|1> <source> <fnv1a64 of JSON.stringify(ast)>
//                E <ecmaVersion> <strict 0|1> <source> <index> <message>
//   visitor.txt  <source> <fnv1a64 of history.join("\n")>          (options {}: ecmaVersion 2025, strict false)
// A string field is its UTF-16 code units: 0x20..0x7e as they are, every other unit and the percent sign as %uXXXX.
"use strict";
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const out = args[0];
const root = args.includes("--regexpp") ? args[args.indexOf("--regexpp") + 1] : "/workspace/ref/regexpp";
if (!out) { console.error("usage: node make-fixtures.cjs <out dir> [--regexpp dir]"); process.exit(1); }
const esc = s => { let r = ""; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); r += c >= 0x20 && c <= 0x7e && c !== 0x25 ? s[i] : "%u" + c.toString(16).padStart(4, "0"); } return r; };
const fnv = text => { let h = 0xcbf29ce484222325n; for (const b of Buffer.from(text, "utf8")) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h.toString(16).padStart(16, "0"); };
function* walk(dir, rel = "") { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { if (e.isDirectory()) yield* walk(path.join(dir, e.name), rel + e.name + "/"); else if (e.name.endsWith(".json")) yield rel + e.name; } }
const literalRoot = path.join(root, "test/fixtures/parser/literal");
const lines = []; const counts = { A: 0, E: 0 };
for (const file of walk(literalRoot)) {
  const fixture = JSON.parse(fs.readFileSync(path.join(literalRoot, file), "utf8"));
  const ecma = fixture.options.ecmaVersion ?? 2025, strict = fixture.options.strict ? 1 : 0;
  lines.push(`# ${file}`);
  for (const [source, result] of Object.entries(fixture.patterns)) {
    if (result.error) { counts.E++; lines.push(["E", ecma, strict, esc(source), result.error.index, esc(result.error.message)].join("\t")); }
    else { counts.A++; lines.push(["A", ecma, strict, esc(source), fnv(JSON.stringify(result.ast))].join("\t")); }
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "literal.txt"), lines.join("\n") + "\n");
const visitor = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/visitor/full.json"), "utf8"));
if (Object.keys(visitor.options).length) throw new Error("visitor fixture has options");
const vlines = Object.entries(visitor.patterns).map(([source, history]) => [esc(source), fnv(history.join("\n"))].join("\t"));
fs.writeFileSync(path.join(out, "visitor.txt"), vlines.join("\n") + "\n");
console.log(counts, "visitor", vlines.length, "bytes", fs.statSync(path.join(out, "literal.txt")).size, fs.statSync(path.join(out, "visitor.txt")).size);
