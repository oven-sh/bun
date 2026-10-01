// usage: node changed-vs-oracle.cjs <head binary> <prototype binary> <corpus.hex>...
// For every source whose first error of the lint parse changed from the head to the prototype: the first diagnostic of typescript-go
// (PARSEDIAG) beside both. Counts how many of the changed ones now equal the reference (code and range), and lists the others.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [head, proto, ...corpora] = process.argv.slice(2);
const bin = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const unhex = h => Buffer.from(h ?? "", "hex").toString();
const changed = [];
for (const corpus of corpora) {
  const lines = fs.readFileSync(corpus, "utf8").split("\n").filter(Boolean);
  const out = {};
  for (const [name, b] of [["head", head], ["proto", proto]]) {
    const file = `/tmp/b4td/cvo-out.${process.pid}.${name}.tsv`;
    const run = spawnSync(b, ["zz_probe"], { env: { ...process.env, B4_INPUTS: corpus, B4_OUT: file }, maxBuffer: 1 << 26 });
    if (run.status !== 0) { console.error(String(run.stderr).slice(-2000)); process.exit(1); }
    out[name] = new Map(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { const i = l.indexOf("\t"); return [l.slice(0, i), l.slice(i + 1)]; }));
    fs.unlinkSync(file);
  }
  for (const line of lines) {
    const [id, kind, hex] = line.split(" ");
    const a = out.head.get(id), b = out.proto.get(id);
    if (a !== b) changed.push({ kind, src: unhex(hex ?? ""), head: a.split("\t"), proto: b.split("\t") });
  }
}
const input = changed.map((r, id) => JSON.stringify({ id, name: "a." + (r.kind === "dts" ? "d.ts" : r.kind), src: r.src })).join("\n") + "\n";
const go = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 28 });
for (const line of go.stdout.split("\n")) { if (!line) continue; const o = JSON.parse(line); changed[o.id].go = o.panic ? null : o.diags.map(d => [d[0], d[1], d[2]]); }
const show = f => f[0] === "ok" ? "parses" : `${JSON.stringify(unhex(f[7]))} @[${f[1]},${+f[1] + +f[2]})` + (f[3] !== "0" ? ` => TS${f[3]} [${f[4]},${f[5]})` : " => no entry");
let equal = 0, headEqual = 0;
const rest = [];
for (const r of changed) {
  const ref = r.go && r.go.length ? r.go[0] : null;
  const eq = f => (ref ? f[0] === "err" && f[3] === String(ref[0]) && +f[4] === ref[1] && +f[5] === ref[1] + ref[2] : f[0] === "ok");
  if (eq(r.head)) headEqual++;
  if (eq(r.proto)) equal++; else rest.push(r);
}
console.log(`${changed.length} sources changed: ${equal} now have the first diagnostic of the reference (code and range) or parse as it does, ${headEqual} had it at the head, ${rest.length} have another`);
for (const r of rest) console.log(`${r.kind} ${JSON.stringify(r.src)}\n    ref:   ${r.go && r.go.length ? `TS${r.go[0][0]} [${r.go[0][1]},${r.go[0][1] + r.go[0][2]})` : r.go ? "parses" : "PANIC"}\n    head:  ${show(r.head)}\n    proto: ${show(r.proto)}`);
