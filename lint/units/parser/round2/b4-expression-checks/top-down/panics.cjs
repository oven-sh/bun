// usage: node panics.cjs <binary> <corpus.hex>...: how many sources make the lint parse panic.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [bin, ...corpora] = process.argv.slice(2);
let total = 0, panics = 0, ok = 0, err = 0;
for (const corpus of corpora) {
  const file = `/tmp/b4td/panics-out.${process.pid}.tsv`;
  const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, B4_INPUTS: corpus, B4_OUT: file }, maxBuffer: 1 << 26 });
  if (run.status !== 0) { console.error(String(run.stderr).slice(-2000)); process.exit(1); }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) { if (!line) continue; total++; const s = line.split("\t")[1]; if (s === "panic") panics++; else if (s === "ok") ok++; else err++; }
  fs.unlinkSync(file);
}
console.log(`${total} lint parses: ${ok} parse, ${err} fail, ${panics} panic`);
