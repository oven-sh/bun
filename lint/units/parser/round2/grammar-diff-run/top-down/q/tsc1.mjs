// bun tsc1.mjs <file with one source per line, U+23CE for a line break>   or sources as arguments
import { readFileSync } from "node:fs";
import { recordOf } from "/tmp/gdr1b/gd/oracle.mjs";
const args = process.argv.slice(2);
const sources = args[0] === "-f" ? readFileSync(args[1], "utf8").split("\n").filter(l => l && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n")) : args;
for (const src of sources) {
  const r = recordOf(src);
  const p = d => d.map(x => `TS${x[0]}@${x[1]}`).join(",");
  console.log(JSON.stringify(src));
  console.log(`   ts: parse[${p(r.ts)}] grammar[${r.chk.ts ? p(r.chk.ts) : "-"}] other[${(r.oth.ts ?? []).join(",")}]` + (r.chk.tsL ? ` legacy[${p(r.chk.tsL)}]` : "") + (r.meta ? ` meta=${JSON.stringify(r.metaLoose ?? r.meta)}` : ""));
  if (JSON.stringify(r.tsx) !== JSON.stringify(r.ts) || JSON.stringify(r.chk.tsx) !== JSON.stringify(r.chk.ts)) console.log(`  tsx: parse[${p(r.tsx)}] grammar[${r.chk.tsx ? p(r.chk.tsx) : "-"}]`);
}
