// Clusters the inputs of a class by what each side says, so that a cluster reads as one thing to fix.
//
// usage: bun clusters.mjs <class: A1|A1c|A1s|A2|A|B|AAg> [group prefix...] [--dialect ts|tsx|dts] [--config plain|deco] [--examples N]
// A1c: A1 where tsc reports nothing about the syntax. A1s: A1 where tsc reports a structural code (report.mjs STRUCTURAL).
//
// A and A1 and A2 cluster by the first error of Bun, with the token text replaced by a placeholder.
// B clusters by the first parse diagnostic of tsc (code and message).
// "tsc also" lists the codes outside the grammar ranges that the checker of tsc reported for the
// inputs of the cluster (2304 cannot find name, 2371 initializer in a signature, ...).
// Output: out/clusters.<class>[.dialect][.config].txt

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effective, readRecords } from "./report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cls = args.shift();
let dialect = "ts";
let config = "plain";
let examples = 6;
const filters = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dialect") dialect = args[++i];
  else if (args[i] === "--config") config = args[++i];
  else if (args[i] === "--examples") examples = Number(args[++i]);
  else filters.push(args[i]);
}

const files = readdirSync(join(HERE, "inputs"))
  .filter(f => f.endsWith(".mjs") && !f.startsWith("_") && !f.startsWith("00") && !f.startsWith("11"))
  .filter(f => !filters.length || filters.some(x => f.startsWith(x)))
  .sort();

const norm = m => m.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/^Unexpected .+$/, "Unexpected …");
const clusters = new Map();
let total = 0;
for (const file of files) {
  const base = file.replace(/\.mjs$/, "");
  const mod = await import(join(HERE, "inputs", file));
  const families = mod.families ?? {};
  for (const e of effective(readRecords(base), dialect, config)) {
    if (e.cls !== cls && e.sub !== cls) continue;
    total++;
    let what;
    if (cls === "B") what = `tsc TS${e.parse[0][0]} ${norm(e.parse[0][3])}`;
    else if (cls === "AAg") what = `tsc TS${e.grammar[0][0]} ${norm(e.grammar[0][3])}`;
    else what = `bun ${norm(e.bun[0][0])}` + (e.grammar.length ? `  /  tsc TS${e.grammar[0][0]} ${norm(e.grammar[0][3])}` : "") + (cls === "A1s" ? `  /  tsc TS${e.structural.join(" TS")}` : "");
    const key = `${base}\t${e.r.fam}\t${what}`;
    if (!clusters.has(key)) clusters.set(key, { n: 0, forms: new Map(), site: families[e.r.fam], other: new Map() });
    const c = clusters.get(key);
    c.n++;
    const t = e.r.tsc[dialect];
    for (const code of new Set(t.other ?? [])) c.other.set(code, (c.other.get(code) ?? 0) + 1);
    const form = e.r.form ?? e.r.src;
    if (!c.forms.has(form)) c.forms.set(form, { src: e.r.src, ctx: [], e });
    c.forms.get(form).ctx.push(e.r.ctx ?? "-");
  }
}
const lines = [`class ${cls}  dialect ${dialect}  config ${config}: ${total} inputs in ${clusters.size} clusters`];
const sorted = [...clusters].sort((a, b) => a[0].localeCompare(b[0]));
for (const [key, c] of sorted) {
  const [base, fam, what] = key.split("\t");
  lines.push("");
  lines.push(`[${base} / ${fam}]  ${what}   (${c.n} inputs, ${c.forms.size} distinct)`);
  if (c.other.size) {
    lines.push(
      "    tsc also: " +
        [...c.other]
          .sort((a, b) => b[1] - a[1])
          .map(([code, n]) => `TS${code} x${n}`)
          .join(", "),
    );
  }
  let i = 0;
  for (const [form, f] of c.forms) {
    if (i++ >= examples) {
      lines.push(`    … ${c.forms.size - examples} more`);
      break;
    }
    const d = cls === "B" ? f.e.parse[0] : null;
    const at = d ? `   tsc @${d[1]}+${d[2]} in ${JSON.stringify(f.src)}` : "";
    lines.push(`    ${JSON.stringify(form)}  [${[...new Set(f.ctx)].slice(0, 8).join(",")}${new Set(f.ctx).size > 8 ? ",…" : ""}]${at}`);
  }
}
const suffix = (dialect === "ts" ? "" : "." + dialect) + (config === "plain" ? "" : "." + config);
writeFileSync(join(HERE, "out", `clusters.${cls}${suffix}.txt`), lines.join("\n") + "\n");
console.log(lines[0]);
