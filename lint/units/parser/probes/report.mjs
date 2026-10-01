// Reads out/<group>.jsonl (written by run.mjs) and writes out/<group>.summary.txt.
//
// usage: bun report.mjs [group prefix...] [--dialect ts|tsx|dts] [--config plain|deco]
//
// --config deco compares Bun with experimentalDecorators + emitDecoratorMetadata against the
// program of tsc with experimentalDecorators (groups with decoProgram). The default compares
// Bun without tsconfig against the program of tsc without experimentalDecorators.
//
// A grammar code that the context alone produces (the same context around the neutral form "A")
// does not count against a form: `catch (e: T)` reports 1196 for every T.
// In the summary a position is relative to the start of the form inside the input, when the input has a form.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const INPUTS = join(HERE, "inputs");

const args = process.argv.slice(2);
let dialect = "ts";
let config = "plain";
const filters = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dialect") dialect = args[++i];
  else if (args[i] === "--config") config = args[++i];
  else filters.push(args[i]);
}

// Codes of the checker of tsc outside the grammar ranges that still name a fault of the syntax.
// The classes of run.mjs follow the grammar ranges alone; A1s and AAs mark the inputs that tsc
// parses, that get no code of the grammar ranges, and that get one of these.
export const STRUCTURAL = new Set([
  2207, 2206, 2300, 2331, 2332, 2337, 2357, 2364, 2369, 2371, 2391, 2452, 2462, 2480, 2483, 2499, 2500, 2660, 2669, 2670, 2680,
  2730, 2784, 2842, 2857, 2858, 5084, 5085, 5086, 5087, 5088, 7061,
]);

export function readRecords(base) {
  const path = join(OUT, base + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

export function effective(recs, dialect, config = "plain") {
  const grammarOf = t => (config === "deco" ? (t.grammarDeco ?? t.grammar) : t.grammar);
  const baseline = {};
  for (const r of recs) {
    if (r.crash || r.form !== "A" || r.ctx === undefined) continue;
    const g = grammarOf(r.tsc[dialect]);
    if (g) baseline[r.ctx] = new Set(g.map(x => x[0]));
  }
  const out = [];
  for (const r of recs) {
    if (r.crash) {
      out.push({ r, cls: "CRASH", sub: "CRASH", structural: [], grammar: [], parse: [], bun: null });
      continue;
    }
    const t = r.tsc[dialect];
    const parse = t.parse === "=" ? r.tsc.ts.parse : t.parse;
    const loader = dialect === "tsx" ? "tsx" : "ts";
    let bun = loader === "tsx" && r.bun.tsx !== "=" ? r.bun.tsx : r.bun.ts;
    if (config === "deco") bun = r.bun.var?.[`${loader}.deco.transformSync`] ?? bun;
    const checked = Array.isArray(t.grammar);
    const base = r.ctx !== undefined ? baseline[r.ctx] : undefined;
    const grammar = (grammarOf(t) ?? []).filter(x => !base?.has(x[0]));
    let cls;
    if (bun === 1) cls = parse.length ? "B" : grammar.length ? "AAg" : "AA";
    else cls = parse.length ? "RR" : checked ? (grammar.length ? "A2" : "A1") : "A";
    const structural = [...new Set(t.other ?? [])].filter(c => STRUCTURAL.has(c));
    // sub: A1c = A1 and tsc says nothing about the syntax, A1s = A1 and tsc reports a structural code.
    const sub = cls === "A1" ? (structural.length ? "A1s" : "A1c") : cls === "AA" ? (structural.length ? "AAs" : "AA") : cls;
    out.push({ r, cls, sub, structural, grammar, parse, bun });
  }
  return out;
}

const rel = (r, start) => {
  if (start === null || start === undefined) return "?";
  if (r.form === undefined) return String(start);
  const at = r.src.indexOf(r.form);
  return at < 0 ? String(start) : "form" + (start - at >= 0 ? "+" : "") + (start - at);
};

function summarize(base, families) {
  const recs = readRecords(base);
  if (!recs.length) return null;
  const eff = effective(recs, dialect, config);
  const lines = [];
  const counts = {};
  for (const e of eff) counts[e.cls] = (counts[e.cls] ?? 0) + 1;
  for (const e of eff) if (e.sub === "A1c" || e.sub === "A1s") counts[e.sub] = (counts[e.sub] ?? 0) + 1;
  lines.push(`group ${base}  dialect ${dialect}  config ${config}  inputs ${recs.length}`);
  lines.push(
    "counts " +
      Object.entries(counts)
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );

  const byFam = new Map();
  for (const e of eff) {
    if (!byFam.has(e.r.fam)) byFam.set(e.r.fam, []);
    byFam.get(e.r.fam).push(e);
  }

  const vary = eff.filter(e => e.r.bun?.var);
  if (vary.length) {
    lines.push("");
    lines.push(`calls of Bun that differ from transformSync without tsconfig: ${vary.length} inputs`);
    for (const e of vary.slice(0, 400)) {
      const v = e.r.bun.var;
      const what = Object.entries(v)
        .map(([k, res]) => `${k}=${res === 1 ? "ok" : JSON.stringify(res[0][0])}`)
        .join(" ");
      lines.push(`  ${JSON.stringify(e.r.src)}  base=${e.bun === 1 ? "ok" : JSON.stringify(e.bun[0][0])}  ${what}`);
    }
  }

  for (const [fam, list] of byFam) {
    const site = families?.[fam];
    lines.push("");
    lines.push(`==== family ${fam}  (${list.length} inputs)`);
    if (site?.bun) lines.push(`  bun: ${site.bun}`);
    if (site?.ref) lines.push(`  ref: ${site.ref}`);
    const c = {};
    for (const e of list) c[e.cls] = (c[e.cls] ?? 0) + 1;
    lines.push(
      "  counts " +
        Object.entries(c)
          .sort()
          .map(([k, v]) => `${k}=${v}`)
          .join(" "),
    );
    for (const cls of ["CRASH", "A1", "A2", "A", "B", "AAg"]) {
      const rows = new Map();
      for (const e of list) {
        if (e.cls !== cls) continue;
        const key = e.r.form ?? e.r.src;
        if (!rows.has(key)) rows.set(key, { ctx: [], bun: new Map(), tsc: new Map(), first: e });
        const row = rows.get(key);
        row.ctx.push(e.r.ctx ?? "-");
        if (e.bun && e.bun !== 1) {
          const b = e.bun[0];
          const k = `${b[0]} @${rel(e.r, b[3])}`;
          row.bun.set(k, (row.bun.get(k) ?? 0) + 1);
        }
        const diags = cls === "B" ? e.parse.slice(0, 1) : e.grammar;
        for (const d of diags) {
          const k = `TS${d[0]} @${rel(e.r, d[1])} len ${d[2]} ${JSON.stringify(d[3])}`;
          row.tsc.set(k, (row.tsc.get(k) ?? 0) + 1);
        }
      }
      if (!rows.size) continue;
      lines.push(`  -- ${cls}: ${rows.size} distinct`);
      for (const [key, row] of rows) {
        lines.push(`    ${JSON.stringify(key)}`);
        if (row.first.r.form !== undefined) {
          const total = list.filter(e => (e.r.form ?? e.r.src) === key).length;
          lines.push(`        contexts (${row.ctx.length} of ${total}): ${row.ctx.join(" ")}`);
        }
        for (const [k, n] of row.bun) lines.push(`        bun x${n}: ${k}`);
        for (const [k, n] of row.tsc) lines.push(`        tsc x${n}: ${k}`);
      }
    }
  }
  return { text: lines.join("\n") + "\n", counts };
}

if (import.meta.main) {
  const files = readdirSync(INPUTS)
    .filter(f => f.endsWith(".mjs") && !f.startsWith("_"))
    .filter(f => !filters.length || filters.some(x => f.startsWith(x)))
    .sort();
  const total = {};
  for (const file of files) {
    const base = file.replace(/\.mjs$/, "");
    const mod = await import(join(INPUTS, file));
    const res = summarize(base, mod.families ?? mod.default.families);
    if (!res) continue;
    const suffix = (dialect === "ts" ? "" : "." + dialect) + (config === "plain" ? "" : "." + config);
    writeFileSync(join(OUT, `${base}${suffix}.summary.txt`), res.text);
    console.log(
      base,
      dialect,
      config,
      Object.entries(res.counts)
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
    );
    for (const [k, v] of Object.entries(res.counts)) total[k] = (total[k] ?? 0) + v;
  }
  console.log(
    "total",
    Object.entries(total)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
  );
}
