// usage: node join.cjs <oracle.jsonl.gz> <meta.jsonl> <probe.tsv> <ts|tsx> <out.jsonl>
// Joins the output of zz_probe.rs (one lint parse for each source) with the oracle of tsc 6.0.2 on the index of the source.
// One line of <out.jsonl> for each source: {i, src, prod, ctx, t, mut, cls, tsc: [code, start, end, text] | null, lint: {code, start, end, at, len, bun, ref} | null}
//   cls  "AA" both parse            "TL" tsc parses, the lint parse rejects (a defect)
//        "LT" the lint parse parses, tsc rejects (a strictness gap)      "RR" both reject
// Offsets are bytes on both sides: the offsets of tsc (UTF-16 units) are converted.
const fs = require("node:fs");
const zlib = require("node:zlib");
const [oraclePath, metaPath, probePath, dialect, outPath] = process.argv.slice(2);
const oracle = zlib.gunzipSync(fs.readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean).slice(1);
const meta = fs.readFileSync(metaPath, "utf8").split("\n").filter(Boolean);
const probe = new Map();
for (const line of fs.readFileSync(probePath, "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  probe.set(Number(f[0]), f);
}
const unhex = h => Buffer.from(h ?? "", "hex").toString("utf8");
const out = fs.createWriteStream(outPath);
const count = { AA: 0, TL: 0, LT: 0, RR: 0, other: 0 };
for (let i = 0; i < oracle.length; i++) {
  const o = JSON.parse(oracle[i]);
  const m = JSON.parse(meta[i]);
  const f = probe.get(i);
  if (f === undefined) throw new Error(`no probe line for source ${i}`);
  const diags = o[dialect];
  const byte = u => (u === null ? null : Buffer.byteLength(o.src.slice(0, u), "utf8"));
  const tsc = diags.length === 0 ? null : [diags[0][0], byte(diags[0][1]), byte(diags[0][1] + diags[0][2]), diags[0][3]];
  let lint = null;
  let stage = f[1];
  if (stage !== "ok") {
    lint = { stage, at: Number(f[2]), len: Number(f[3]), code: Number(f[4]), start: Number(f[5]), end: Number(f[6]), msgs: Number(f[7]), bun: unhex(f[8]), ref: unhex(f[9]) };
  }
  let cls;
  if (stage !== "ok" && stage !== "err" && stage !== "init") cls = "other";
  else cls = lint === null ? (tsc === null ? "AA" : "LT") : tsc === null ? "TL" : "RR";
  count[cls]++;
  out.write(JSON.stringify({ i, src: o.src, prod: m.prod, ctx: m.ctx, t: m.t, mut: m.mut, from: m.from, cls, tsc, tscAll: diags.length > 1 ? diags.map(d => d[0]) : undefined, lint }) + "\n");
}
out.end();
console.log(`${probePath} as ${dialect}: ${oracle.length} sources; both parse ${count.AA}; both reject ${count.RR}; tsc parses, lint rejects ${count.TL}; lint parses, tsc rejects ${count.LT}; other ${count.other}`);
