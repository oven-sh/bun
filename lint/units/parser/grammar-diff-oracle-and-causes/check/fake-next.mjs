// Scratch: a "next" run for the test rows: the base run with the expectation of each test as the value of its api.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
const lines = gunzipSync(readFileSync("/tmp/gdo/base.testrows.jsonl.gz")).toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const header = lines[0];
const rows = JSON.parse(readFileSync("/tmp/gdo/testrows.base.json", "utf8"));
const API = { ts: "t.ts.plain", tsx: "t.tsx.plain", deco: "t.ts.deco" };
function metaNext(baseText, key, expected) {
  const re = /__legacyMetadataTS\w*\("(design:\w+)", /g;
  for (let m; (m = re.exec(baseText)); ) {
    let depth = 0, i = re.lastIndex;
    for (; i < baseText.length; i++) {
      const c = baseText[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    }
    if (m[1] === "design:" + key) return baseText.slice(0, re.lastIndex) + expected + baseText.slice(i);
  }
  throw new Error("no " + key);
}
const bySrc = new Map(lines.slice(1).map(r => [r.src, r]));
let changed = 0;
for (const row of rows) {
  if (row.loader === "js") continue;
  const rec = bySrc.get(row.src);
  const at = header.apis.indexOf(API[row.loader]);
  const old = rec.vals[rec.res[at]];
  const value = ["o", row.key ? metaNext(old[1], row.key, row.expected) : row.expected];
  if (JSON.stringify(old) === JSON.stringify(value)) continue;
  rec.vals.push(value);
  rec.res[at] = rec.vals.length - 1;
  changed++;
}
header.revision = "fake: the expectations of the four test files";
writeFileSync("/tmp/gdo/next.testrows.jsonl.gz", gzipSync([header, ...lines.slice(1)].map(x => JSON.stringify(x)).join("\n") + "\n"));
console.log(changed, "values replaced");
