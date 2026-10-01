// bun forms.mjs <diff.jsonl> <regex on cause> [max forms per cause]
import { readFileSync } from "node:fs";
const [file, pattern, max] = process.argv.slice(2);
const re = new RegExp(pattern);
const by = new Map();
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  const key = `${d.cause}\t${d.cls}`;
  if (!re.test(key)) continue;
  if (!by.has(key)) by.set(key, new Map());
  const m = by.get(key);
  const form = d.t ?? d.src;
  if (!m.has(form)) m.set(form, { ctx: new Set(), apis: new Set(), base: d.base, n: 0, src: d.src });
  const e = m.get(form);
  e.ctx.add(d.ctx ?? "-"); e.apis.add(d.api); e.n++;
}
for (const [key, m] of by) {
  let sources = 0;
  console.log(`## ${key.replace("\t", "  ")}  (${m.size} forms)`);
  let n = 0;
  for (const [form, e] of m) {
    if (n++ >= Number(max ?? 1e9)) { console.log("   ..."); break; }
    const msg = e.base[0] === "e" ? e.base[1][0][0] : "";
    console.log(`   ${JSON.stringify(form)}  ctx[${[...e.ctx].join(",")}] apis=${e.apis.size} recs=${e.n}  base: ${msg}`);
  }
}
