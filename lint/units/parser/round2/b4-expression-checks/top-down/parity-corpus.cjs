// usage: node parity-corpus.cjs <head binary> <prototype binary> <corpus.hex>...
// A parse without lint (the parse pass as `Parser::parse` runs it, no side table) of every source of each corpus with both binaries:
// every message (offset, length, code, text) and the count of errors must be the same.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [head, proto, ...corpora] = process.argv.slice(2);
let total = 0, differ = 0, rejected = 0, panics = 0;
for (const corpus of corpora) {
  const out = {};
  for (const [name, bin] of [["head", head], ["proto", proto]]) {
    const file = `/tmp/b4td/pc-out.${process.pid}.${name}.tsv`;
    const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, B4_MODE: "nolint", B4_INPUTS: corpus, B4_OUT: file }, maxBuffer: 1 << 26 });
    if (run.status !== 0) { console.error(String(run.stderr).slice(-2000)); process.exit(1); }
    out[name] = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    fs.unlinkSync(file);
  }
  for (let i = 0; i < out.head.length; i++) {
    total++;
    const a = out.head[i], b = out.proto[i];
    const status = a.split("\t")[1];
    if (status === "err") rejected++;
    if (status === "panic" || (b ?? "").split("\t")[1] === "panic") panics++;
    if (a !== b) { differ++; if (differ <= 20) console.log(`DIFFERS\n  head:  ${a}\n  proto: ${b}`); }
  }
}
console.log(`${total} parses without lint: ${rejected} rejected by the head, ${panics} panics, ${differ} differ`);
