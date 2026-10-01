// Compares the verdicts of another build with the saved table of the base build, row by row.
//
// usage: 1. <new bun> classify.mjs stage1 <corpus.jsonl> <work dir>          (--tsgo is not needed)
//        2. bun progress.mjs <corpus.jsonl> <work dir> [<out/table.jsonl.gz of the base, default ./out/table.jsonl.gz>]
//
// The base table holds, per row: the verdict of the base build (b), the parse diagnostics of tsc (t) and of
// typescript-go (g), and for set A the checker codes (v). Only the bun side is new.
// Per view (ts, tsx, deco) it prints
//   accepted by the base, rejected now        must be empty for a parse without lint (every row is listed)
//   set A fixed / left, by class              the worklist is class A1v
//   rejected by both before, accepted now     input that tsc's parser rejects: must be empty (every row is listed)
//   set B still accepted                      must be all of set B
// Exit code 1 when a row of the two lists that must be empty exists.
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [corpusPath, work, tablePath = join(dirname(fileURLToPath(import.meta.url)), "out", "table.jsonl.gz")] = process.argv.slice(2);
const lines = text => text.split("\n").filter(Boolean).map(l => JSON.parse(l));
const corpus = lines(readFileSync(corpusPath, "utf8"));
const base = lines(gunzipSync(readFileSync(tablePath)).toString("utf8"));
const info = JSON.parse(readFileSync(join(work, "stage1.info.json"), "utf8"));
const next = new Map();
for (let s = 0; s < info.jobs; s++) {
  const p = join(work, `bun.${s}.jsonl`);
  if (existsSync(p)) for (const r of lines(readFileSync(p, "utf8"))) if (!r.done) next.set(r.i, r);
}

const isGrammar = c => c < 2000 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
// The same rule as report.mjs (rule R): A3 when a code says that the shape of a declaration is wrong.
const SHAPE = new Set([
  2207, 2206, 2300, 2331, 2332, 2337, 2357, 2364, 2369, 2371, 2391, 2452, 2462, 2480, 2483, 2499, 2500, 2660, 2669, 2670, 2680,
  2730, 2784, 2842, 2857, 2858, 5084, 5085, 5086, 5087, 5088, 7061, 2323, 2335, 2395, 2440, 2451, 2567, 2813,
]);
const NAME_CODES = new Set([2304, 2552, 2503, 2693, 2694, 2749]);
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends finally for function if import in instanceof new return super switch throw try var while with".split(" "),
);
const classOf = (src, one) => {
  if (!one) return "A?";
  const codes = [...new Set(one.c.map(x => x[0]))];
  if (codes.some(isGrammar)) return "A2";
  if (codes.some(c => SHAPE.has(c))) return "A3";
  if (one.js !== 1 && one.js !== undefined) return "A1j";
  return one.c.some(x => NAME_CODES.has(x[0]) && RESERVED.has(src.slice(x[1], x[1] + x[2]))) ? "A1r" : "A1v";
};

const VIEWS = { ts: [0, "ts"], tsx: [1, "tsx"], deco: [2, "ts"] };
let bad = 0;
console.log(`new build: ${info.bun}  sha256 ${info.execSha256}`);
for (const [view, [slot, dialect]] of Object.entries(VIEWS)) {
  const regress = [];
  const lenient = [];
  const fixed = {};
  const left = {};
  let bKept = 0;
  let bTotal = 0;
  let crashes = 0;
  for (const row of corpus) {
    const o = base[row.i];
    const n = next.get(row.i);
    if (!n || o.b === "CRASH") continue;
    if (n.crash) {
      crashes++;
      regress.push(`CRASH ${JSON.stringify(row.src)}`);
      continue;
    }
    const was = o.b[slot] === 1;
    const now = n.b[slot] === 1;
    const tscOk = o.t[dialect][0] === 0;
    if (was && !tscOk) {
      bTotal++;
      if (now) bKept++;
    }
    if (was && !now) regress.push(`${tscOk ? "AA" : "B "} ${JSON.stringify(row.src)}  ->  ${n.b[slot][0]}`);
    else if (!was && now && !tscOk) lenient.push(`${JSON.stringify(row.src)}  tsc: TS${o.t[dialect][2][0]} ${o.t[dialect][1]}`);
    else if (!was && tscOk) {
      const c = classOf(row.src, o.v?.[view]);
      (now ? fixed : left)[c] = ((now ? fixed : left)[c] ?? 0) + 1;
    }
  }
  console.log(`\n==== view ${view}`);
  console.log(`accepted by the base, rejected now: ${regress.length}${crashes ? ` (${crashes} crashes)` : ""}`);
  for (const l of regress.slice(0, 200)) console.log("    " + l.slice(0, 220));
  console.log(`set A fixed: ${JSON.stringify(fixed)}   left: ${JSON.stringify(left)}`);
  console.log(`rejected by both before, accepted now: ${lenient.length}`);
  for (const l of lenient.slice(0, 200)) console.log("    " + l.slice(0, 220));
  console.log(`set B still accepted: ${bKept} of ${bTotal}`);
  bad += regress.length + lenient.length;
}
process.exit(bad ? 1 : 0);
