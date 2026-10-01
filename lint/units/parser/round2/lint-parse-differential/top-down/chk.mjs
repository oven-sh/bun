// usage: node chk.mjs <oracle module> <out.jsonl> <join.jsonl>...
// For every source of class "TL" (tsc parses, the lint parse rejects) in the join files: what tsc 6.0.2 as a whole says.
// <oracle module> is grammar-diff-oracle-and-causes/for-grammar-diff/oracle.mjs beside a copy of grammar-diff/harness.mjs.
// One line for each distinct source: {src, ts?: {grammar: [[code, start, length, text]], other: [codes]}, tsx?: {...}, tsL?, tsxL?}
//   ts / tsx    the semantic diagnostics of a program whose one file is the source, for each dialect in which it is of class TL
//   tsL / tsxL  the same with experimentalDecorators, for a source with "@"
import { readFileSync, writeFileSync } from "node:fs";
const [modulePath, outPath, ...joins] = process.argv.slice(2);
const { check } = await import(modulePath);
const wanted = new Map();
for (const path of joins) {
  const dialect = /\.tsx\./.test(path) ? "tsx" : "ts";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"cls":"TL"')) continue;
    const r = JSON.parse(line);
    if (!wanted.has(r.src)) wanted.set(r.src, new Set());
    wanted.get(r.src).add(dialect);
  }
}
const lines = [];
let threw = 0;
for (const [src, dialects] of wanted) {
  const record = { src };
  for (const dialect of dialects) {
    try {
      record[dialect] = check(src, dialect, false);
      if (src.includes("@")) record[dialect + "L"] = check(src, dialect, true);
    } catch (e) {
      record[dialect + "Threw"] = String(e?.message ?? e).slice(0, 200);
      threw++;
    }
  }
  lines.push(JSON.stringify(record));
}
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`${outPath}: ${wanted.size} sources, ${threw} where the checker threw`);
