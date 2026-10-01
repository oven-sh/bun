// node make-test-rows.cjs <inputs.json> <x.tsc.tsv> <x.lint.tsv> <id prefix>  ->  rows of a Rust table on stdout:
// (name, loader, source, comments before the first token, "start-end:kind,...") for every input that tsc and the probe read the same way.
const fs = require("fs");
const [inputsFile, tscFile, lintFile, prefix] = process.argv.slice(2);
const read = f => new Map(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { const c = l.split("\t"); return [c[0], c.slice(1)]; }));
const tsc = read(tscFile), lint = read(lintFile);
const loaders = { ts: "Loader::Ts", dts: "Loader::Ts", tsx: "Loader::Tsx", js: "Loader::Js", jsx: "Loader::Jsx" };
const paths = { ts: "/a.ts", dts: "/a.d.ts", tsx: "/a.tsx", js: "/a.js", jsx: "/a.jsx" };
function bytes(text) {
  let out = "";
  for (const b of Buffer.from(text, "utf8")) {
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x22) out += '\\"';
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x0d) out += "\\r";
    else if (b === 0x09) out += "\\t";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += "\\x" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
let rows = 0, skipped = [];
for (const [name, loader, code] of JSON.parse(fs.readFileSync(inputsFile, "utf8"))) {
  const id = prefix + ":" + name;
  const t = tsc.get(id), l = lint.get(id);
  if (!t || !l || t[0] !== "ok" || l[0] !== "ok" || t[1] !== l[1] || (t[2] || "") !== (l[2] || "")) { skipped.push(name); continue; }
  console.log(`    ("${name}", b"${paths[loader]}", ${loaders[loader]}, b"${bytes(code)}", ${t[1]}, "${t[2] || ""}"),`);
  rows++;
}
console.error(`${rows} rows, skipped: ${skipped.join(", ") || "none"}`);
