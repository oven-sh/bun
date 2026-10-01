// What a new build changes against the saved results of the base build, over the rows that matter.
// The binary that runs this file is the build under test.
//
//   <bun under test> progress.mjs <work dir> [--all] [--jobs=N]
//
// Rows: the sources of class A or B (base build) and every source that an existing test pins; with --all
// the whole corpus (327,745 sources: minutes with a release build, hours with a debug build).
// Reads  data/corpus.jsonl.gz, data/bun.base.jsonl.gz, data/pinned.jsonl.gz, out/classes.jsonl.gz, out/setA.tsv.gz
// Writes <work dir>/progress.tsv (one row per source and configuration that changed) and prints the counts:
//   fixed       class A, the new build accepts                     (the goal of P1.1; by class D2 of the row)
//   lost        the base build accepts, the new build rejects      (never allowed for a parse without lint)
//   widened     class RR, the new build accepts                    (tsc rejects the source: needs a reason)
//   output      both accept, the printed text differs              (expected only for decorator metadata)
//   message     both reject, the error list differs
// Exit code 1 when a row is lost or the new build crashes on a source.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBunSide, readJsonl, readLines, tsv } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const work = args.find(a => !a.startsWith("--"));
const all = args.includes("--all");
const jobs = args.find(a => a.startsWith("--jobs="))?.slice(7) ?? "4";
if (!work) {
  console.error("usage: <bun under test> progress.mjs <work dir> [--all] [--jobs=N]");
  process.exit(2);
}
mkdirSync(work, { recursive: true });
const corpus = readJsonl(join(HERE, "data", "corpus.jsonl.gz"));
const classes = new Map(readJsonl(join(HERE, "out", "classes.jsonl.gz")).map(r => [r.id, r]));
const pinnedSources = new Set(readJsonl(join(HERE, "data", "pinned.jsonl.gz")).map(p => p.src));
const d2 = new Map();
for (const line of readLines(join(HERE, "out", "setA.tsv.gz")).slice(1)) {
  const f = line.split("\t");
  d2.set(Number(f[0]), f[4]);
}
const rows = corpus.filter(r => {
  if (all) return true;
  const c = classes.get(r.id);
  return c.ts === "A" || c.ts === "B" || c.tsx === "A" || c.tsx === "B" || pinnedSources.has(r.src);
});
const subsetPath = join(work, "subset.jsonl");
writeFileSync(subsetPath, rows.map(r => JSON.stringify({ id: r.id, src: r.src })).join("\n") + "\n");
const newPath = join(work, "bun.new.jsonl.gz");
const run = spawnSync(process.execPath, [join(HERE, "bun-side.mjs"), subsetPath, newPath, `--jobs=${jobs}`], { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
const base = readBunSide(join(HERE, "data", "bun.base.jsonl.gz"));
const next = readBunSide(newPath);
const counts = { fixed: {}, lost: 0, widened: 0, output: 0, message: 0, crash: 0 };
const out = ["kind\tid\tconfiguration\tclass of the source (ts/tsx)\tD2\tbase build\tnew build\tsource"];
const show = v => (v[0] === "o" ? `ok ${v[1]}` : v[1].map(e => `${e[0]} @${e[3]}`).join(" | "));
for (const r of rows) {
  const a = base.out.get(r.id);
  const b = next.out.get(r.id);
  const c = classes.get(r.id);
  if (b.crash !== undefined) {
    if (a.crash === undefined) {
      counts.crash++;
      out.push(`crash\t${r.id}\t*\t${c.ts}/${c.tsx}\t\t\t${b.crash}\t${tsv(r.src)}`);
    }
    continue;
  }
  if (a.crash !== undefined) continue;
  for (const cfg of base.header.configs) {
    const x = a[cfg];
    const y = b[cfg];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const cls = cfg.startsWith("tsx") ? c.tsx : c.ts;
    let kind;
    if (x[0] === "e" && y[0] === "o") {
      if (cls === "A") {
        kind = "fixed";
        const k = d2.get(r.id) ?? "A";
        if (cfg === "ts" || (cfg === "tsx" && c.ts !== "A")) counts.fixed[k] = (counts.fixed[k] ?? 0) + 1;
      } else {
        kind = "widened";
        counts.widened++;
      }
    } else if (x[0] === "o" && y[0] === "e") {
      kind = "lost";
      counts.lost++;
    } else if (x[0] === "o") {
      kind = "output";
      counts.output++;
    } else {
      kind = "message";
      counts.message++;
    }
    out.push(`${kind}\t${r.id}\t${cfg}\t${c.ts}/${c.tsx}\t${d2.get(r.id) ?? ""}\t${show(x)}\t${show(y)}\t${tsv(r.src)}`);
  }
}
writeFileSync(join(work, "progress.tsv"), out.join("\n") + "\n");
console.log(`${Bun.version} ${Bun.revision.slice(0, 9)} against the base build ${base.header.revision.slice(0, 9)}: ${rows.length} sources${all ? " (whole corpus)" : " (class A, class B and pinned sources)"}`);
console.log(`  fixed (class A, now accepted; sources counted once, by class D2): ${JSON.stringify(counts.fixed)}`);
console.log(`  lost (accepted by the base build, now rejected; pairs of source and configuration): ${counts.lost}`);
console.log(`  widened (class RR, now accepted): ${counts.widened}`);
console.log(`  output differs: ${counts.output}    error list differs: ${counts.message}    new crashes: ${counts.crash}`);
process.exit(counts.lost > 0 || counts.crash > 0 ? 1 : 0);
