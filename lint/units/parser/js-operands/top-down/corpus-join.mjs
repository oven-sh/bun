// Joins the records of corpus-worker.mjs (bun) and corpus-tsc.cjs (tsc) by file: where bun's JavaScript
// instantiation and tsc's parser disagree on acceptance. A `.js` or `.jsx` file is bun's jsx, `.mjs` and `.cjs` bun's js.
// usage: bun corpus-join.mjs <tsc jsonl> <bun jsonl>... [--list <class>]
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const li = args.indexOf("--list");
const want = li >= 0 ? args[li + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && (li < 0 || i !== li + 1));
const tsc = new Map();
for (const line of readFileSync(files[0], "utf8").split("\n")) { if (line) { const r = JSON.parse(line); tsc.set(r.file, r); } }
const counts = {}, samples = {}, seen = new Set();
const bump = (k, f, extra) => { counts[k] = (counts[k] || 0) + 1; (samples[k] ||= []).push([f.replace("/workspace/wt/parser/", ""), extra]); };
for (const f of files.slice(1)) {
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.skip || seen.has(r.sha)) continue;
    seen.add(r.sha);
    const t = tsc.get(r.file);
    if (!t || t.crash) { bump("tsc crashed or missing", r.file, t && t.crash); continue; }
    const ext = r.file.slice(r.file.lastIndexOf("."));
    const natural = ext === ".mjs" || ext === ".cjs" ? r.js : r.jsx;
    const withJsx = r.jsx, asTs = ext === ".mjs" || ext === ".cjs" ? r.tsx : r.tsx;
    const tscOk = t.n === 0;
    const k1 = `${ext}: bun(own loader) ${natural.ok ? "accepts" : "rejects"}, tsc ${tscOk ? "accepts" : "rejects"}`;
    bump(k1, r.file, tscOk ? natural.errors && natural.errors[0] : t.parse[0]);
    if (ext === ".mjs" || ext === ".cjs") {
      if (!natural.ok && withJsx.ok) bump(`${ext}: bun js rejects, bun jsx accepts (tsc ${tscOk ? "accepts" : "rejects"})`, r.file, natural.errors[0]);
    }
    if (natural.ok && !tscOk) bump("TSC REJECTS what bun runs: TS" + t.parse[0].code, r.file, t.parse[0]);
    if (!withJsx.ok && tscOk) bump(`bun jsx rejects, tsc accepts: bun tsx ${asTs.ok ? "accepts" : "rejects"}`, r.file, withJsx.errors[0]);
  }
}
for (const k of Object.keys(counts).sort()) console.log(String(counts[k]).padStart(7), k);
if (want) for (const [f, e] of samples[want] || []) console.log(f, e ? JSON.stringify(e) : "");
