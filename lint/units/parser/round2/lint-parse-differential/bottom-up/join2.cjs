// Joins the lint-parse probe (two option sets) with the extended tsc oracle (parse diagnostics, grammar errors of the checker, other codes)
// and with a run of harness.mjs of the release binary of the same commit (a parse without lint).
//   node join2.cjs <corpus.json> <extended oracle.jsonl.gz> <harness run.jsonl.gz> <probe.lint.tsv> <probe.plain.tsv> <out.jsonl>
// One line per source and dialect:
//   {i, d, src, prod, ctx, t, mut, cls, tsc: [[code,start,end,text]...], chk: [[code,start,end,text]...] | null, oth: [codes] | null,
//    lint: null | {code,start,end,off,len,msgs,bun,ref,stage}, lintPlain: the same with the options of the tests,
//    full: null | [message...] (transformSync, parse and visit), scan: null | [message...] (scanImports, the parse pass alone)}
// Offsets are byte offsets. cls: "AA", "A" (tsc parses, the lint parse rejects), "B" (tsc rejects, the lint parse accepts), "RR".
const fs = require("fs");
const zlib = require("zlib");
const [corpusPath, oraclePath, runPath, lintPath, plainPath, outPath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const [ctx, template] of Object.entries(corpus.contexts)) inputs.push({ src: template.replace("%T%", () => f.t), ctx, t: f.t, prod: f.prod, mut: f.mut });
for (const s of corpus.sources) inputs.push({ src: s.src, ctx: null, t: null, prod: s.prod, mut: null });
const gz = p => zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
const oracle = new Map();
for (const l of gz(oraclePath).slice(1)) { const r = JSON.parse(l); oracle.set(r.src, r); }
const runLines = gz(runPath);
const apis = JSON.parse(runLines[0]).apis;
const at = name => apis.indexOf(name);
const run = new Map();
for (const l of runLines.slice(1)) {
  const r = JSON.parse(l);
  const val = name => { const v = r.vals[r.res[at(name)]]; return v[0] === "e" ? v[1].map(e => e[0]) : null; };
  run.set(r.src, r.crash !== undefined ? { crash: r.crash } : { ts: { full: val("t.ts.plain"), scan: val("i.ts.plain") }, tsx: { full: val("t.tsx.plain"), scan: val("i.tsx.plain") } });
}
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const toByte = (src, p) => (p === null ? null : Buffer.byteLength(src.slice(0, p), "utf8"));
const conv = (src, list) => list.map(([code, start, length, text]) => [code, toByte(src, start), toByte(src, start === null ? null : start + (length ?? 0)), text]);
const parseLine = f => {
  if (f[1] === "ok") return null;
  if (f[1] === "panic") return { stage: "panic", panic: unhex(f[2]) };
  return { stage: f[1], off: Number(f[2]), len: Number(f[3]), code: Number(f[4]), start: Number(f[5]), end: Number(f[6]), msgs: Number(f[7]), bun: unhex(f[8]), ref: unhex(f[9]) };
};
const plain = new Map();
for (const line of fs.readFileSync(plainPath, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); plain.set(f[0], parseLine(f)); }
const out = fs.createWriteStream(outPath);
const count = {};
for (const line of fs.readFileSync(lintPath, "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [idx, d] = f[0].split(".");
  const i = Number(idx);
  const input = inputs[i];
  const o = oracle.get(input.src);
  if (!o) throw new Error(`no oracle record for source ${i}`);
  const h = run.get(input.src);
  const tsc = conv(input.src, o[d]);
  const lint = parseLine(f);
  const cls = tsc.length === 0 ? (lint ? "A" : "AA") : lint ? "RR" : "B";
  count[`${d} ${cls}`] = (count[`${d} ${cls}`] ?? 0) + 1;
  const chk = o.chk && o.chk[d] !== undefined ? conv(input.src, o.chk[d]) : null;
  const chkL = o.chk && o.chk[d + "L"] !== undefined ? conv(input.src, o.chk[d + "L"]) : undefined;
  const oth = o.oth && o.oth[d] !== undefined ? o.oth[d] : tsc.length === 0 ? [] : null;
  out.write(JSON.stringify({ i, d, src: input.src, prod: input.prod, ctx: input.ctx, t: input.t, mut: input.mut, cls, tsc, chk, chkL, oth, lint, lintPlain: plain.get(f[0]), full: h && h[d] ? h[d].full : undefined, scan: h && h[d] ? h[d].scan : undefined }) + "\n");
}
out.end(() => { for (const key of Object.keys(count).sort()) console.log(`  ${String(count[key]).padStart(7)}  ${key}`); });
