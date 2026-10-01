// Classifies the records of corpus-worker.mjs: acceptance and output of js against ts, and of jsx against tsx.
// usage: bun corpus-digest.mjs <jsonl>... [--list <class>]
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const li = args.indexOf("--list");
const want = li >= 0 ? args[li + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && (li < 0 || i !== li + 1));
const seen = new Set();
const counts = {};
const samples = {};
let total = 0, dup = 0;
function bump(k, rec, extra) {
  counts[k] = (counts[k] || 0) + 1;
  (samples[k] ||= []).push({ file: rec.file.replace("/workspace/wt/parser/", ""), extra });
}
for (const f of files) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.skip) { bump("unreadable", r); continue; }
    if (seen.has(r.sha)) { dup++; continue; }
    seen.add(r.sha);
    total++;
    for (const [a, b] of [["js", "ts"], ["jsx", "tsx"]]) {
      const A = r[a], B = r[b];
      const pair = a + "/" + b;
      if (!A.ok && !B.ok) bump(pair + " both reject", r, A.errors[0].m + " || " + B.errors[0].m);
      else if (A.ok && !B.ok) bump(pair + " TS REJECTS", r, B.errors[0]);
      else if (!A.ok && B.ok) bump(pair + " TS accepts, JS rejects", r, A.errors[0]);
      else if (A.h === B.h) bump(pair + " same output", r);
      else bump(pair + " OUTPUT DIFFERS", r, `${A.n} vs ${B.n}`);
    }
    if (r.js.ok !== r.jsx.ok) bump("js/jsx acceptance differs", r, (r.js.ok ? r.jsx : r.js).errors[0]);
    else if (r.js.ok && r.js.h !== r.jsx.h) bump("js/jsx output differs", r);
  }
}
console.log("unique files", total, "duplicates skipped", dup);
for (const k of Object.keys(counts).sort()) console.log(String(counts[k]).padStart(7), k);
if (want) for (const s of samples[want] || []) console.log(s.file, s.extra ? JSON.stringify(s.extra) : "");
