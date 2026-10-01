// usage: node differential.cjs <head binary> <prototype binary> <corpus.hex>...
// The lint parse of every source of each corpus (lines `<id> <ts|js|...> <hex>`) with both binaries. Prints how the first error changed,
// by class, with examples: every class must be one that the change intends.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [head, proto, ...corpora] = process.argv.slice(2);
const unhex = h => Buffer.from(h ?? "", "hex").toString();
const classes = new Map();
let total = 0, same = 0;
for (const corpus of corpora) {
  const lines = fs.readFileSync(corpus, "utf8").split("\n").filter(Boolean);
  const out = {};
  for (const [name, bin] of [["head", head], ["proto", proto]]) {
    const file = `/tmp/b4td/diff-out.${process.pid}.${name}.tsv`;
    const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, B4_INPUTS: corpus, B4_OUT: file }, maxBuffer: 1 << 26 });
    if (run.status !== 0) { console.error(String(run.stderr).slice(-2000)); process.exit(1); }
    out[name] = new Map(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("\t"); return [l.slice(0, i), l.slice(i + 1)]; }));
    fs.unlinkSync(file);
  }
  for (const line of lines) {
    const [id, kind, hex] = line.split(" ");
    const a = out.head.get(id), b = out.proto.get(id);
    total++;
    if (a === b) { same++; continue; }
    const fa = (a ?? "missing").split("\t"), fb = (b ?? "missing").split("\t");
    const show = f => f[0] === "ok" ? "parses" : f[0] === "panic" ? "PANIC" : `${JSON.stringify(unhex(f[7]).replace(/"[^"]*"/g, '"…"').replace(/Unexpected .*/, m => (m === 'Unexpected "…"' ? m : "Unexpected <token>")).replace(/call '.*'/, "call '…'").replace(/the '[^']*' operator/, "the '…' operator"))}` + (f[3] !== "0" ? ` TS${f[3]}` : " (no entry)");
    const key = `${show(fa)}  ==>  ${show(fb)}`;
    const entry = classes.get(key) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 4) entry.examples.push(`${kind} ${JSON.stringify(unhex(hex ?? ""))}`);
    classes.set(key, entry);
  }
}
console.log(`${total} sources, ${same} with the same first error (or both parse), ${total - same} changed, in ${classes.size} classes`);
for (const [key, entry] of [...classes].sort((x, y) => y[1].count - x[1].count)) {
  console.log(`\n${String(entry.count).padStart(6)}  ${key}`);
  for (const example of entry.examples) console.log(`          ${example}`);
}
