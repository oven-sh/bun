// Prints, per input, the fields where two oracle outputs differ: node cmp.cjs expected-tsc.txt expected-go.txt
const fs = require("fs");
const parse = f => {
  const out = new Map();
  let cur;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (line.startsWith("--- ")) {
      cur = {};
      out.set(line.split(" ")[1], cur);
    } else if (line.startsWith("  ")) {
      const i = line.indexOf("=");
      cur[line.slice(2, i)] = line.slice(i + 1);
    }
  }
  return out;
};
const a = parse(process.argv[2]), b = parse(process.argv[3]);
const fields = (process.argv[4] || "referencedFiles,typeReferenceDirectives,libReferenceDirectives,checkJsDirective,diagnostics").split(",");
let same = 0;
for (const [name, x] of a) {
  const y = b.get(name) || {};
  const diffs = fields.filter(f => (x[f] || "") !== (y[f] || ""));
  if (!diffs.length) { same++; continue; }
  console.log(name);
  for (const f of diffs) console.log(`  ${f}: ${x[f]}  |  ${y[f]}`);
}
console.log(`same: ${same} of ${a.size}`);
