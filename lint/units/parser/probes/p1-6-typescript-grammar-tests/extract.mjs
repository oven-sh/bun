// usage: bun extract.mjs   reads ../out/candidates.typescript-grammar.test.ts, writes candidates.json: [{group, which, src, expected, note}]
import { readFileSync, writeFileSync } from "node:fs";
const text = readFileSync(new URL("../out/candidates.typescript-grammar.test.ts", import.meta.url), "utf8").split("\n");
const rows = [];
let group = null;
let pending = [];
for (const line of text) {
  let m;
  if ((m = /^describe\((".*"), \(\) => \{$/.exec(line))) { group = JSON.parse(m[1]); continue; }
  if (/^\s+test(\.todo)?\.each\(\[$/.test(line)) { pending = []; continue; }
  if ((m = /^\s+\]\)\((".*"), /.exec(line))) {
    const title = JSON.parse(m[1]);
    const which = title.split(" ")[0] === "%j" ? "meta" : title.replace(" %j", "");
    for (const r of pending) rows.push({ group, which, ...r });
    pending = [];
    continue;
  }
  if (/^\s+\[/.test(line)) {
    const at = line.lastIndexOf("], //");
    const body = at >= 0 ? line.slice(0, at + 1) : line.replace(/,\s*$/, "");
    const note = at >= 0 ? line.slice(at + 5).trim() : "";
    let arr;
    try { arr = JSON.parse(body.trim()); } catch (e) { console.error("cannot parse", line.slice(0, 120)); continue; }
    pending.push({ src: arr[0], expected: arr[1], note });
  }
}
writeFileSync(new URL("candidates.json", import.meta.url), JSON.stringify(rows, null, 1));
const count = {};
for (const r of rows) count[r.group + " / " + r.which] = (count[r.group + " / " + r.which] ?? 0) + 1;
console.log(rows.length, "rows");
for (const [k, v] of Object.entries(count)) console.log(String(v).padStart(4), k);
