// Joins a run of the lint-parse probe with the tsc oracle of the same corpus.
//   node join.cjs <corpus.json> <oracle.jsonl.gz> <probe.tsv> <out.jsonl>
// One line per source and dialect: {i, d, src, prod, ctx, t, mut, cls, tsc: [[code,start,end,text]...] (byte offsets), lint: null | {code,start,end,off,len,msgs,bun,ref,stage}}
// cls: "AA" both accept, "A" tsc parses and the lint parse rejects, "B" tsc rejects and the lint parse accepts, "RR" both reject.
const fs = require("fs");
const zlib = require("zlib");
const [corpusPath, oraclePath, probePath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const [ctx, template] of Object.entries(corpus.contexts)) inputs.push({ src: template.replace("%T%", () => f.t), ctx, t: f.t, prod: f.prod, mut: f.mut });
for (const s of corpus.sources) inputs.push({ src: s.src, ctx: null, t: null, prod: s.prod, mut: null });
const oracle = zlib.gunzipSync(fs.readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean).slice(1).map(l => JSON.parse(l));
if (oracle.length !== inputs.length) throw new Error(`oracle ${oracle.length} inputs ${inputs.length}`);
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
// UTF-16 offset of tsc to the byte offset of the source
const toByte = (src, at) => (at === null ? null : Buffer.byteLength(src.slice(0, at), "utf8"));
const out = fs.createWriteStream(outPath);
const count = {};
const lines = fs.readFileSync(probePath, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const f = line.split("\t");
  const [idx, d] = f[0].split(".");
  const i = Number(idx);
  const input = inputs[i];
  const o = oracle[i];
  if (o.src !== input.src) throw new Error(`source ${i} differs`);
  const tsc = o[d].map(([code, start, length, text]) => [code, toByte(input.src, start), toByte(input.src, start === null ? null : start + (length ?? 0)), text]);
  let lint = null;
  if (f[1] !== "ok") {
    if (f[1] === "panic") lint = { stage: "panic", panic: unhex(f[2]) };
    else lint = { stage: f[1], off: Number(f[2]), len: Number(f[3]), code: Number(f[4]), start: Number(f[5]), end: Number(f[6]), msgs: Number(f[7]), bun: unhex(f[8]), ref: unhex(f[9]) };
  }
  const cls = tsc.length === 0 ? (lint ? "A" : "AA") : lint ? "RR" : "B";
  count[`${d} ${cls}`] = (count[`${d} ${cls}`] ?? 0) + 1;
  out.write(JSON.stringify({ i, d, src: input.src, prod: input.prod, ctx: input.ctx, t: input.t, mut: input.mut, cls, tsc, lint }) + "\n");
}
out.end(() => {
  console.log(probePath, lines.length, "parses");
  for (const key of Object.keys(count).sort()) console.log(`  ${String(count[key]).padStart(7)}  ${key}`);
});
