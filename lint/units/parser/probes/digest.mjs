// One line per distinct form and class: the short list behind summary.txt.
//
// usage: bun digest.mjs [group prefix...] [--dialect ts|tsx|dts] [--config plain|deco]
// Output: out/digest.<group>[.dialect][.config].txt, lines
//   <class>\t<family>\t<form or input>\t[contexts]\tbun: first message\ttsc: code @position+length message
// Classes: A1c, A1s, A2, A, B, CRASH (report.mjs). A position is relative to the form when the input has one.

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effective, readRecords } from "./report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let dialect = "ts";
let config = "plain";
const filters = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dialect") dialect = args[++i];
  else if (args[i] === "--config") config = args[++i];
  else filters.push(args[i]);
}
const files = readdirSync(join(HERE, "inputs"))
  .filter(f => f.endsWith(".mjs") && !f.startsWith("_") && !f.startsWith("11"))
  .filter(f => !filters.length || filters.some(x => f.startsWith(x)))
  .sort();

const ORDER = ["CRASH", "A1c", "A1s", "A2", "A", "B"];
for (const file of files) {
  const base = file.replace(/\.mjs$/, "");
  const rows = new Map();
  for (const e of effective(readRecords(base), dialect, config)) {
    if (!ORDER.includes(e.sub)) continue;
    const form = e.r.form ?? e.r.src;
    const key = `${e.sub}\t${e.r.fam}\t${JSON.stringify(form)}`;
    if (!rows.has(key)) rows.set(key, { ctx: [], e });
    rows.get(key).ctx.push(e.r.ctx ?? "-");
  }
  const lines = [];
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a[1].e.sub) - ORDER.indexOf(b[1].e.sub));
  for (const [key, { ctx, e }] of sorted) {
    const at = start => (start === null || e.r.form === undefined ? start : start - e.r.src.indexOf(e.r.form));
    const bun = e.bun && e.bun !== 1 ? `bun: ${e.bun[0][0]} @${at(e.bun[0][3])}` : "bun: accepts";
    const d = e.sub === "B" ? e.parse[0] : e.grammar[0];
    const other = e.structural.length ? ` also TS${e.structural.join(" TS")}` : "";
    const tsc = d ? `tsc: TS${d[0]} @${at(d[1])}+${d[2]} ${d[3]}${other}` : `tsc: parses${other}`;
    lines.push(`${key}\t[${ctx.join(",")}]\t${bun}\t${tsc}`);
  }
  const suffix = (dialect === "ts" ? "" : "." + dialect) + (config === "plain" ? "" : "." + config);
  writeFileSync(join(HERE, "out", `digest.${base}${suffix}.txt`), lines.join("\n") + "\n");
  console.log(base, dialect, config, lines.length, "lines");
}
