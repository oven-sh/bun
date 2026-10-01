// Decorator metadata of the bun binary that runs this file against tsc 6.0.2, for every row of the corpus that
// holds a decorator and that both sides accept (stage 1 of classify.mjs decides).
//
// usage: <bun> metadata.mjs <corpus.jsonl> <work dir of classify.mjs> <out dir>
//
// Both outputs go through extractMetadata of probes/top-down/runner.mjs: one entry per decorated target with the
// normal form of design:type, design:paramtypes and design:returntype (ref(a.b) stands for a guarded reference).
//   bun          Bun.Transpiler({loader: "ts", tsconfig: experimentalDecorators + emitDecoratorMetadata})
//   tsc loose    ts.transpileModule with strict: false, strictNullChecks: false   (the rule Bun implements)
//   tsc default  ts.transpileModule with the defaults of 6.0.2 (strict)
// Writes
//   metadata.table.tsv.gz   i, verdict (same | differ | bun-none | tsc-none), bun, tsc loose, tsc default when it
//                           differs from loose, source
//   metadata.diff.txt       the differing rows grouped by (key, value of bun, value of tsc loose), with counts
//   metadata.summary.txt
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const [corpusPath, work, outDir] = process.argv.slice(2);
const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const RUNNER = process.env.PROBE_RUNNER ?? "/workspace/notes/lint/units/parser/probes/top-down/runner.mjs";
const ts = (await import(TS_PATH)).default;
const { extractMetadata, metadataText } = await import(RUNNER);
mkdirSync(outDir, { recursive: true });

const readLines = p =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
const corpus = readLines(corpusPath);
const info = JSON.parse(readFileSync(join(work, "stage1.info.json"), "utf8"));
const shards = mode => {
  const m = new Map();
  for (let s = 0; s < info.jobs; s++) {
    const p = join(work, `${mode}.${s}.jsonl`);
    if (existsSync(p)) for (const r of readLines(p)) if (!r.done) m.set(r.i, r);
  }
  return m;
};
const bun = shards("bun");
const tsc = shards("tsc");

const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpiler = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const emit = (src, extra) => {
  try {
    return ts.transpileModule(src, {
      fileName: "input.ts",
      reportDiagnostics: false,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        useDefineForClassFields: false,
        noEmitHelpers: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        ...extra,
      },
    }).outputText;
  } catch (e) {
    return null;
  }
};
const tsv = v => String(v ?? "").replaceAll("\t", " ").replaceAll("\n", "\\n");
const inc = (o, k) => (o[k] = (o[k] ?? 0) + 1);

const table = ["i\tverdict\tbun\ttsc loose\ttsc default (when it differs)\tsource"];
const counts = {};
const groups = {};
let strictDiffers = 0;
for (const row of corpus) {
  if (!row.src.includes("@")) continue;
  const b = bun.get(row.i);
  const t = tsc.get(row.i);
  if (!b || b.crash || b.b[2] !== 1 || t.t.ts[0] !== 0) continue;
  let out;
  try {
    out = transpiler.transformSync(row.src);
  } catch {
    continue;
  }
  const loose = emit(row.src, { strict: false, strictNullChecks: false });
  const strict = emit(row.src, {});
  if (loose === null) {
    inc(counts, "tsc emit threw");
    continue;
  }
  const bm = extractMetadata(out);
  const lm = extractMetadata(loose);
  const sm = strict === null ? null : extractMetadata(strict);
  if (!bm.length && !lm.length) {
    inc(counts, "no metadata on either side");
    continue;
  }
  const bt = metadataText(bm);
  const lt = metadataText(lm);
  const st = sm === null ? "THREW" : metadataText(sm);
  // The two compilers name a target differently in places: compare the entries in order.
  const be = bm.map(e => e.entries);
  const le = lm.map(e => e.entries);
  let verdict;
  if (!bm.some(e => Object.keys(e.entries).length) && lm.some(e => Object.keys(e.entries).length)) verdict = "bun-none";
  else if (bm.some(e => Object.keys(e.entries).length) && !lm.some(e => Object.keys(e.entries).length)) verdict = "tsc-none";
  else verdict = JSON.stringify(be) === JSON.stringify(le) ? "same" : "differ";
  inc(counts, verdict);
  if (st !== lt) strictDiffers++;
  table.push([row.i, verdict, tsv(bt), tsv(lt), st !== lt ? tsv(st) : "", tsv(row.src)].join("\t"));
  if (verdict !== "same") {
    const n = Math.max(be.length, le.length);
    const seen = new Set();
    for (let k = 0; k < n; k++) {
      for (const key of ["type", "paramtypes", "returntype"]) {
        const x = be[k]?.[key];
        const y = le[k]?.[key];
        if (x === y) continue;
        const sig = `${key}: bun ${x ?? "(absent)"}  tsc ${y ?? "(absent)"}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const g = (groups[sig] ??= { n: 0, ex: [], origins: {} });
        g.n++;
        g.ex.push(row.src);
        for (const o of row.o) inc(g.origins, o.replace(/@.*$/, "").replace(/\/m$/, ""));
      }
    }
  }
}
writeFileSync(join(outDir, "metadata.table.tsv.gz"), gzipSync(table.join("\n") + "\n", { level: 9 }));
const D = ["Differing metadata by (key, value of bun, value of tsc with strictNullChecks off). A row counts once per distinct difference.", ""];
for (const [sig, g] of Object.entries(groups).sort((a, b) => b[1].n - a[1].n)) {
  D.push(`${String(g.n).padStart(6)}  ${sig}`);
  D.push(`        origins: ${Object.entries(g.origins).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => `${o}x${n}`).join(" ")}`);
  for (const s of g.ex.sort((a, b) => a.length - b.length).slice(0, 3)) D.push(`        ${JSON.stringify(s).slice(0, 150)}`);
}
writeFileSync(join(outDir, "metadata.diff.txt"), D.join("\n") + "\n");
const S = [
  `bun side: ${Bun.version} ${Bun.revision}   tsc ${ts.version}`,
  `rows with a decorator that both sides accept and where a side emits metadata: ${table.length - 1}`,
  ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
  `rows where tsc with its defaults (strict) emits other metadata than with strictNullChecks off: ${strictDiffers}`,
  `distinct (key, bun value, tsc value) differences: ${Object.keys(groups).length}`,
];
writeFileSync(join(outDir, "metadata.summary.txt"), S.join("\n") + "\n");
console.log(S.join("\n"));
