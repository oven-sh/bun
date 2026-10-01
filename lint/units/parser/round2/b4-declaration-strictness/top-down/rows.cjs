// usage: node rows.cjs <inputs.json> [group prefix ...]  > rows
// The rows of the Rust tables, from typescript-go 89d5d5b (/tmp/rr/parsediag-bu): for a source that its parser rejects
// `(b"source", Loader::X, code, start, end, "text"),` with byte offsets of its first diagnostic, and for a source that it
// takes `b"source", // Loader::X`. A row says what the reference does, not what the tree does today.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const GO = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const prefixes = process.argv.slice(3);
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + l);
const loaderOf = l => ({ ts: "Loader::Ts", dts: "Loader::Ts /* a.d.ts */", tsx: "Loader::Tsx", js: "Loader::Js", jsx: "Loader::Jsx" })[l];
const lines = inputs.map((r, id) => JSON.stringify({ id, name: nameOf(r.l || "ts"), src: r.s })).join("\n") + "\n";
const out = spawnSync(GO, [], { input: lines, maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(out.stdout).split("\n")) if (line) { const r = JSON.parse(line); go.set(r.id, r); }
const lit = s => 'b"' + [...Buffer.from(s, "utf8")].map(b => b === 0x22 ? '\\"' : b === 0x5c ? "\\\\" : b === 0x0a ? "\\n" : b === 0x0d ? "\\r" : b === 0x09 ? "\\t" : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "\\x" + b.toString(16).padStart(2, "0")).join("") + '"';
let group = null;
inputs.forEach((r, id) => {
  if (prefixes.length && !prefixes.some(p => String(r.g).startsWith(p))) return;
  if (r.g !== group) { group = r.g; console.log("// " + group); }
  const g = go.get(id);
  const l = r.l || "ts";
  if (!g || g.panic) { console.log(`// ${lit(r.s)}: no answer of the reference`); return; }
  const d = (g.diags || [])[0];
  if (!d) { console.log(`${lit(r.s)}, // ${loaderOf(l)}: parses`); return; }
  console.log(`(${lit(r.s)}, ${loaderOf(l)}, ${d[0]}, ${d[1]}, ${d[1] + d[2]}, ${JSON.stringify(d[5])}),`);
});
