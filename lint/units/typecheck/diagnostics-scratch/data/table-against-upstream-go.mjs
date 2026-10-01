// Compares the message table of the tree with upstream's generated Go file, entry for entry, and prints the numbers that diagnostics/tests.rs asserts.
// usage: bun table-against-upstream-go.mjs [path of diagnostics_generated.rs]   exit 1 when an entry differs
import fs from "node:fs";
const GO = "/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go";
const RS = process.argv[2] ?? "/workspace/wt/typecheck/src/typecheck/diagnostics/diagnostics_generated.rs";
const go = fs.readFileSync(GO, "utf8");
const goRow =
  /^var (\w+) = &Message\{code: (-?\d+), category: Category(\w+), key: ("(?:[^"\\]|\\.)*"), text: ("(?:[^"\\]|\\.)*")((?:, \w+: true)*)\}$/gm;
const goList = [];
let m;
while ((m = goRow.exec(go))) {
  const f = m[6];
  goList.push({
    name: m[1],
    code: +m[2],
    category: m[3],
    key: JSON.parse(m[4]),
    text: JSON.parse(m[5]),
    flags:
      (f.includes("reportsUnnecessary") ? 1 : 0) |
      (f.includes("elidedInCompatibilityPyramid") ? 2 : 0) |
      (f.includes("reportsDeprecated") ? 4 : 0),
  });
}
const goVars = (go.match(/^var \w+ = &Message\{/gm) || []).length;
const rs = fs.readFileSync(RS, "utf8");
const rsRow = /^    \((\w+), (\d+), (\w+), (\d+), ("(?:[^"\\]|\\.)*")\),$/gm;
const rsList = [];
while ((m = rsRow.exec(rs))) rsList.push({ name: m[1], code: +m[2], category: m[3], flags: +m[4], text: JSON.parse(m[5]) });
let bad = goVars === goList.length ? 0 : 1;
for (let i = 0; i < Math.max(goList.length, rsList.length); i++) {
  const g = goList[i];
  const r = rsList[i];
  const same =
    g && r && g.name.toUpperCase() === r.name && g.code === r.code && g.category === r.category && g.flags === r.flags && g.text === r.text;
  if (!same) {
    bad++;
    if (bad < 10) console.log("differs at", i, JSON.stringify(g), JSON.stringify(r));
  }
}
console.log(`go: ${goVars} vars, ${goList.length} read; rust: ${rsList.length} rows; entries that differ: ${bad}`);

// The numbers of diagnostics/tests.rs, from the Go file alone.
let keys = "";
let textBytes = 0;
const byCategory = { Warning: 0, Error: 0, Suggestion: 0, Message: 0 };
const byFlag = [0, 0, 0];
const byArgs = new Array(8).fill(0);
for (const g of goList) {
  keys += g.key + "\n";
  textBytes += Buffer.byteLength(g.text);
  byCategory[g.category]++;
  for (let bit = 0; bit < 3; bit++) byFlag[bit] += (g.flags >> bit) & 1;
  let count = 0;
  for (const p of g.text.matchAll(/\{(\d+)\}/g)) count = Math.max(count, +p[1] + 1);
  byArgs[count]++;
}
let hash = 0xcbf29ce484222325n;
for (const b of Buffer.from(keys)) hash = ((hash ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
console.log(`keys: ${Buffer.byteLength(keys)} bytes, fnv1a64 0x${hash.toString(16)}; texts: ${textBytes} bytes`);
console.log(`by category ${JSON.stringify(byCategory)}; unnecessary, elided, deprecated ${JSON.stringify(byFlag)}; by argument count ${JSON.stringify(byArgs)}`);
console.log(`first code ${goList[0].code}, last code ${goList.at(-1).code}`);
process.exit(bad === 0 ? 0 : 1);
