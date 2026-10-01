// usage: node join.cjs <oracle.jsonl.gz> <go.jsonl> <meta.jsonl> <probe.tsv> <ts|tsx> <out.jsonl>
// Joins the output of zz_probe.rs (one lint parse for each source) with the two oracles on the index of the source:
// tsc 6.0.2 (grammar-diff/oracle.*.jsonl.gz) and typescript-go 89d5d5b (go-oracle.cjs), which is the reference of the port.
// One line of <out.jsonl> for each source:
//   {i, src, prod, ctx, t, mut, from, cls, clsTsc, go: [code, start, end, text] | null, goAll?, tsc: [code, start, end, text] | null,
//    lint: {stage, code, start, end, at, len, msgs, bun, ref} | null}
//   cls     by typescript-go: "AA" both parse; "TL" the reference parses, the lint parse rejects (a defect);
//           "LT" the lint parse parses, the reference rejects (a strictness gap); "RR" both reject
//   clsTsc  the same by tsc 6.0.2
// Offsets are bytes on every side: the offsets of tsc (UTF-16 units) are converted.
const fs = require("node:fs");
const zlib = require("node:zlib");
const [oraclePath, goPath, metaPath, probePath, dialect, outPath] = process.argv.slice(2);
const oracle = zlib.gunzipSync(fs.readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean).slice(1);
const go = fs.readFileSync(goPath, "utf8").split("\n").filter(Boolean);
const meta = fs.readFileSync(metaPath, "utf8").split("\n").filter(Boolean);
const probe = new Map();
for (const line of fs.readFileSync(probePath, "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  probe.set(Number(f[0]), f);
}
const unhex = h => Buffer.from(h ?? "", "hex").toString("utf8");
const out = fs.createWriteStream(outPath);
const count = { AA: 0, TL: 0, LT: 0, RR: 0 };
const countTsc = { AA: 0, TL: 0, LT: 0, RR: 0 };
let other = 0;
for (let i = 0; i < oracle.length; i++) {
  const o = JSON.parse(oracle[i]);
  const m = JSON.parse(meta[i]);
  const g = JSON.parse(go[i]);
  const f = probe.get(i);
  if (f === undefined) throw new Error(`no probe line for source ${i}`);
  if (g.i !== i) throw new Error(`line ${i} of the go oracle is source ${g.i}`);
  const diags = o[dialect];
  const byte = u => (u === null ? null : Buffer.byteLength(o.src.slice(0, u), "utf8"));
  const tsc = diags.length === 0 ? null : [diags[0][0], byte(diags[0][1]), byte(diags[0][1] + diags[0][2]), diags[0][3]];
  const ref = g.d.length === 0 ? null : [g.d[0][0], g.d[0][1], g.d[0][1] + g.d[0][2], g.d[0][3]];
  let lint = null;
  const stage = f[1];
  if (stage !== "ok") {
    if (stage !== "err" && stage !== "init") other++;
    lint = { stage, at: Number(f[2]), len: Number(f[3]), code: Number(f[4]), start: Number(f[5]), end: Number(f[6]), msgs: Number(f[7]), bun: unhex(f[8]), ref: unhex(f[9]) };
  }
  const cls = lint === null ? (ref === null ? "AA" : "LT") : ref === null ? "TL" : "RR";
  const clsTsc = lint === null ? (tsc === null ? "AA" : "LT") : tsc === null ? "TL" : "RR";
  count[cls]++;
  countTsc[clsTsc]++;
  out.write(JSON.stringify({ i, src: o.src, prod: m.prod, ctx: m.ctx, t: m.t, mut: m.mut, from: m.from, cls, clsTsc, go: ref, goAll: g.d.length > 1 ? g.d.map(d => d[0]) : undefined, tsc, lint }) + "\n");
}
out.end();
const show = c => `both parse ${c.AA}; both reject ${c.RR}; reference parses, lint rejects ${c.TL}; lint parses, reference rejects ${c.LT}`;
console.log(`${probePath} as ${dialect}: ${oracle.length} sources, ${other} neither ok nor err\n    typescript-go: ${show(count)}\n    tsc 6.0.2    : ${show(countTsc)}`);
