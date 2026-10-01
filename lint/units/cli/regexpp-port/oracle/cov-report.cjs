// Lists the ranges of regexpp's index.js that no run under NODE_V8_COVERAGE reached.
const fs = require("fs"), path = require("path");
const dir = process.argv[2];
const target = "/workspace/ref/eslint/node_modules/@eslint-community/regexpp/index.js";
const src = fs.readFileSync(target, "utf8");
// count per character: the innermost range wins within one run; across runs a character is covered when any run covers it.
const covered = new Uint8Array(src.length);
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const script of j.result) {
    if (!script.url.endsWith("regexpp/index.js")) continue;
    const local = new Int32Array(src.length).fill(-1);
    for (const fn of script.functions) for (const r of fn.ranges) for (let i = r.startOffset; i < r.endOffset && i < src.length; i++) local[i] = r.count;
    for (let i = 0; i < src.length; i++) if (local[i] > 0) covered[i] = 1;
  }
}
const lineOf = off => src.slice(0, off).split("\n").length;
let i = 0; const holes = [];
while (i < src.length) {
  if (covered[i]) { i++; continue; }
  let j = i; while (j < src.length && !covered[j]) j++;
  const text = src.slice(i, j);
  if (/[A-Za-z]/.test(text)) holes.push([lineOf(i), lineOf(j), text.replace(/\s+/g, " ").trim().slice(0, 150)]);
  i = j;
}
console.log("uncovered ranges:", holes.length);
for (const h of holes) console.log(`${h[0]}-${h[1]}: ${h[2]}`);
