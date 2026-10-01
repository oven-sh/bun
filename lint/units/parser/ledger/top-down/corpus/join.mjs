// Phase 1 of the classifier: joins the four sides and writes the class of every source.
//
//   bun join.mjs <data dir> <out dir>
//
// Reads  <data>/corpus.jsonl.gz, bun.base.jsonl.gz, bun.installed.jsonl.gz, tsc.jsonl.gz, tsgo.jsonl.gz.
// Writes <out>/classes.jsonl.gz   {"id","ts":cls,"tsx":cls,"dts":cls?} with cls one of AA RR A B CRASH
//                                 (A: tsc parses without a diagnostic, Bun rejects.  B: Bun accepts, tsc reports one.)
//        <out>/a-rows.jsonl       the rows of class A in their primary dialect (input of check.mjs)
//        <out>/installed-vs-base.tsv, tsc-vs-tsgo.tsv, deco-config-verdicts.tsv, crashes.tsv, join.summary.txt
// The Bun verdict is the one of the base build, configuration "ts" for the dialects ts and dts, "tsx" for tsx.
// The primary dialect of a source is tsx when every origin of it names tsx, else ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readBunSide, readJsonl, readParseSide, tsv } from "./lib.mjs";

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error("usage: bun join.mjs <data dir> <out dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const corpus = readJsonl(join(dataDir, "corpus.jsonl.gz"));
const base = readBunSide(join(dataDir, "bun.base.jsonl.gz"));
const inst = readBunSide(join(dataDir, "bun.installed.jsonl.gz"));
const tsc = readParseSide(join(dataDir, "tsc.jsonl.gz"));
const tsgo = readParseSide(join(dataDir, "tsgo.jsonl.gz"));

const summary = [];
const say = s => {
  summary.push(s);
  console.log(s);
};
say(`corpus ${corpus.length} distinct sources`);
say(`base build      ${base.header.version} ${base.header.revision}  (${base.header.execPath})`);
say(`installed build ${inst.header.version} ${inst.header.revision}  (${inst.header.execPath})`);
say(`tsc ${tsc.header.typescript}, typescript-go ${tsgo.header.typescriptGo}`);

const classOf = (bunValue, parse) => {
  if (!bunValue) return "CRASH";
  const bunOk = bunValue[0] === "o";
  const tscOk = parse[0] === 0;
  return bunOk ? (tscOk ? "AA" : "B") : tscOk ? "A" : "RR";
};

const classes = [];
const aRows = [];
const counts = { ts: {}, tsx: {}, dts: {}, primary: {} };
const bySet = {};
const crashes = [];
for (const rec of corpus) {
  const b = base.out.get(rec.id);
  const t = tsc.out.get(rec.id);
  const row = { id: rec.id };
  if (b.crash !== undefined) {
    crashes.push(`base\t${rec.id}\t${b.crash}\t${tsv(rec.src)}\t${rec.o.join(" ")}`);
    row.ts = row.tsx = "CRASH";
  } else {
    row.ts = classOf(b.ts, t.ts);
    row.tsx = classOf(b.tsx, t.tsx);
    if (t.dts) row.dts = classOf(b.ts, t.dts);
  }
  classes.push(JSON.stringify(row));
  const primary = rec.tsxOnly ? "tsx" : "ts";
  for (const d of ["ts", "tsx", "dts"]) if (row[d]) counts[d][row[d]] = (counts[d][row[d]] ?? 0) + 1;
  counts.primary[row[primary]] = (counts.primary[row[primary]] ?? 0) + 1;
  for (const s of rec.sets) {
    bySet[s] ??= {};
    bySet[s][row[primary]] = (bySet[s][row[primary]] ?? 0) + 1;
  }
  if (row[primary] === "A") aRows.push(JSON.stringify({ id: rec.id, dialect: primary, src: rec.src, deco: !!rec.deco }));
  else if (row.ts !== "A" && row.tsx === "A" && rec.tsx) aRows.push(JSON.stringify({ id: rec.id, dialect: "tsx", src: rec.src, deco: !!rec.deco }));
}
writeFileSync(join(outDir, "classes.jsonl.gz"), gzipSync(classes.join("\n") + "\n"));
writeFileSync(join(outDir, "a-rows.jsonl"), aRows.join("\n") + "\n");
const fmtCounts = c => ["AA", "RR", "A", "B", "CRASH"].map(k => `${k}=${c[k] ?? 0}`).join(" ");
say("");
say("classes with the base build (A: tsc parses, Bun rejects.  B: Bun accepts, tsc rejects)");
say(`  primary dialect  ${fmtCounts(counts.primary)}`);
say(`  as .ts           ${fmtCounts(counts.ts)}`);
say(`  as .tsx          ${fmtCounts(counts.tsx)}`);
say(`  as .d.ts (Bun: loader ts; only sources of a declaration-file origin)  ${fmtCounts(counts.dts)}`);
say("  per origin set, primary dialect (a source counts in every set that carries it)");
for (const [s, c] of Object.entries(bySet)) say(`    ${s.padEnd(5)} ${fmtCounts(c)}`);
say(`  rows written for the checker pass (class A in the primary dialect, or A only as tsx for a tsx origin): ${aRows.length}`);

// installed build against base build, every configuration
{
  const kinds = {};
  const rows = [];
  const sources = new Set();
  for (const rec of corpus) {
    const a = inst.out.get(rec.id);
    const b = base.out.get(rec.id);
    if (a.crash !== undefined || b.crash !== undefined) {
      if ((a.crash !== undefined) !== (b.crash !== undefined)) {
        kinds["crash on one side"] = (kinds["crash on one side"] ?? 0) + 1;
        rows.push(`crash-one-side\t${rec.id}\t*\t${tsv(rec.src)}\t${a.crash ?? ""}\t${b.crash ?? ""}`);
        sources.add(rec.id);
      }
      if (a.crash !== undefined) crashes.push(`installed\t${rec.id}\t${a.crash}\t${tsv(rec.src)}\t${rec.o.join(" ")}`);
      continue;
    }
    for (const cfg of base.header.configs) {
      const x = a[cfg];
      const y = b[cfg];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      let kind;
      if (x[0] === "o" && y[0] === "e") kind = "A>R  installed accepts, base rejects";
      else if (x[0] === "e" && y[0] === "o") kind = "R>A  installed rejects, base accepts";
      else if (x[0] === "o") kind = "A>A  both accept, the output differs";
      else if (JSON.stringify(x[1][0]) !== JSON.stringify(y[1][0])) {
        kind = x[1][0][0] === "Backtrack" ? 'R>R  first error differs: installed says "Backtrack" without a position' : "R>R  first error differs";
      } else kind = "R>R  first error equal, later errors differ";
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      sources.add(rec.id);
      const show = v => (v[0] === "o" ? `ok ${v[1]}` : v[1].map(e => `${e[0]} @${e[3]}`).join(" | "));
      rows.push(`${kind.slice(0, 3)}\t${rec.id}\t${cfg}\t${tsv(rec.src)}\t${show(x)}\t${show(y)}`);
    }
  }
  writeFileSync(join(outDir, "installed-vs-base.tsv.gz"), gzipSync("kind\tid\tconfig\tsource\tinstalled\tbase\n" + rows.join("\n") + "\n"));
  say("");
  say(`installed build against base build: ${rows.length} (source, configuration) pairs differ, in ${sources.size} sources of ${corpus.length}`);
  for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(7)}  ${k}`);
}

// Bun verdict with and without the decorator options
{
  const rows = [];
  for (const rec of corpus) {
    const b = base.out.get(rec.id);
    if (b.crash !== undefined) continue;
    for (const [plain, deco] of [
      ["ts", "tsD"],
      ["tsx", "tsxD"],
    ]) {
      if ((b[plain][0] === "o") !== (b[deco][0] === "o")) {
        rows.push(`${plain}\t${rec.id}\t${tsv(rec.src)}\t${b[plain][0] === "o" ? "ok" : b[plain][1][0][0]}\t${b[deco][0] === "o" ? "ok" : b[deco][1][0][0]}`);
      }
    }
  }
  writeFileSync(join(outDir, "deco-config-verdicts.tsv"), "loader\tid\tsource\twithout the decorator options\twith experimentalDecorators + emitDecoratorMetadata\n" + rows.join("\n") + "\n");
  say("");
  say(`base build, verdict changes when experimentalDecorators + emitDecoratorMetadata are on: ${rows.length} (loader, source) pairs`);
}

// tsc against typescript-go
{
  const kinds = {};
  const rows = [];
  const sources = new Set();
  let nonAscii = 0;
  for (const rec of corpus) {
    const a = tsc.out.get(rec.id);
    const g = tsgo.out.get(rec.id);
    const ascii = /^[\x00-\x7f]*$/.test(rec.src);
    for (const d of ["ts", "tsx", "dts"]) {
      if (!a[d] || !g[d]) continue;
      const x = a[d];
      const y = g[d];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      let kind;
      if (x[0] === -1 || y[0] === -1) kind = "one parser threw";
      else if ((x[0] === 0) !== (y[0] === 0)) kind = x[0] === 0 ? "VERDICT  tsc parses, typescript-go reports a diagnostic" : "VERDICT  tsc reports a diagnostic, typescript-go parses";
      else if (x[1][0][0] !== y[1][0][0]) kind = "first code differs";
      else if (x[1][0][1] !== y[1][0][1] || x[1][0][2] !== y[1][0][2]) kind = ascii ? "first code equal, its start or length differs" : "first code equal, start or length differs, source is not ASCII (UTF-16 against UTF-8 offsets)";
      else if (x[1][0][3] !== y[1][0][3]) kind = "first diagnostic equal but for its message text";
      else if (x[0] !== y[0]) kind = "first diagnostic equal, the number of diagnostics differs";
      else kind = "first diagnostic and count equal, a later diagnostic differs";
      if (!ascii) nonAscii++;
      kinds[kind] = kinds[kind] ?? {};
      kinds[kind][d] = (kinds[kind][d] ?? 0) + 1;
      sources.add(rec.id);
      const show = v => `${v[0]}: ` + v[1].map(e => `TS${e[0]}@${e[1]}+${e[2]} ${e[3]}`).join(" | ");
      rows.push(`${kind}\t${d}\t${rec.id}\t${tsv(rec.src)}\t${show(x)}\t${show(y)}\t${rec.o[0]}`);
    }
  }
  rows.sort();
  writeFileSync(join(outDir, "tsc-vs-tsgo.tsv.gz"), gzipSync("kind\tdialect\tid\tsource\ttsc 6.0.2 (count: first four)\ttypescript-go 89d5d5b\tfirst origin\n" + rows.join("\n") + "\n"));
  say("");
  say(`tsc 6.0.2 against typescript-go 89d5d5b: ${rows.length} (source, dialect) pairs differ, in ${sources.size} sources (${nonAscii} pairs with a non-ASCII source)`);
  for (const [k, c] of Object.entries(kinds).sort()) say(`  ${k}: ${Object.entries(c).map(([d, n]) => `${d}=${n}`).join(" ")}`);
}

writeFileSync(join(outDir, "crashes.tsv"), "build\tid\tcrash\tsource\torigins\n" + crashes.join("\n") + "\n");
say("");
say(`crashes: ${crashes.length} (build, source) pairs, see crashes.tsv`);
writeFileSync(join(outDir, "join.summary.txt"), summary.join("\n") + "\n");
