// usage: node mkhex.cjs <corpus.json> <oracle.jsonl.gz> <out prefix>
// Writes <out prefix>.ts.hex and <out prefix>.tsx.hex: one line for each source of the corpus, `<index> <ts|tsx> <hex of the source>`,
// the input of zz_probe.rs. The index is the position in expand(corpus) of grammar-diff/harness.mjs, which is the line of the oracle.
// It checks that source i of the corpus is the `src` of record i of the oracle, and stops where it is not.
const fs = require("node:fs");
const zlib = require("node:zlib");
const [corpusPath, oraclePath, prefix] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) {
  for (const [ctx, template] of Object.entries(corpus.contexts)) {
    inputs.push({ src: template.replace("%T%", () => f.t), ctx, t: f.t, prod: f.prod, mut: f.mut ?? null, from: f.from ?? null });
  }
}
for (const s of corpus.sources) inputs.push({ src: s.src, ctx: null, t: null, prod: s.prod, mut: null, from: null });
const oracle = zlib.gunzipSync(fs.readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean).slice(1);
if (oracle.length !== inputs.length) throw new Error(`${oracle.length} oracle records for ${inputs.length} sources`);
let nonAscii = 0;
for (let i = 0; i < inputs.length; i++) {
  const record = JSON.parse(oracle[i]);
  if (record.src !== inputs[i].src) throw new Error(`source ${i} differs from the oracle`);
  if (/[^\x00-\x7f]/.test(inputs[i].src)) nonAscii++;
}
for (const kind of ["ts", "tsx"]) {
  const out = fs.createWriteStream(`${prefix}.${kind}.hex`);
  for (let i = 0; i < inputs.length; i++) out.write(`${i} ${kind} ${Buffer.from(inputs[i].src, "utf8").toString("hex")}\n`);
  out.end();
}
fs.writeFileSync(`${prefix}.meta.jsonl`, inputs.map((x, i) => JSON.stringify({ i, ctx: x.ctx, t: x.t, prod: x.prod, mut: x.mut, from: x.from })).join("\n") + "\n");
console.log(`${corpus.name}: ${inputs.length} sources, ${nonAscii} with a character outside ASCII`);
