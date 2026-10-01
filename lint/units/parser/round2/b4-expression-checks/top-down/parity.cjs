// usage: node parity.cjs <head binary> <prototype binary> <inputs module>... [--rows test-rows.txt]
// A parse without lint (the parse pass as `Parser::parse` runs it, no side table) of every source, as a.ts and as a.js, with both
// binaries: every message (offset, length, code, text) and the count of errors must be the same.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const [head, proto] = args.splice(0, 2);
const sources = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--rows") {
    for (const line of fs.readFileSync(args[++i], "utf8").split("\n")) {
      const m = /^\(b"((?:[^"\\]|\\.)*)", Loader::/.exec(line);
      if (m) sources.add(JSON.parse('"' + m[1] + '"'));
    }
  } else for (const [, list] of require(path.resolve(args[i]))) for (const src of list) sources.add(src);
}
const rows = [];
for (const src of sources) for (const loader of ["ts", "js"]) rows.push({ loader, src });
const input = `/tmp/b4td/parity-in.${process.pid}.hex`;
fs.writeFileSync(input, rows.map((r, id) => `${id} ${r.loader} ${Buffer.from(r.src, "utf8").toString("hex")}`).join("\n") + "\n");
const out = {};
for (const [name, bin] of [["head", head], ["proto", proto]]) {
  const file = `/tmp/b4td/parity-out.${process.pid}.${name}.tsv`;
  const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, B4_MODE: "nolint", B4_INPUTS: input, B4_OUT: file }, maxBuffer: 1 << 26 });
  if (run.status !== 0) { console.error(String(run.stdout).slice(-2000), String(run.stderr).slice(-2000)); process.exit(1); }
  out[name] = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  fs.unlinkSync(file);
}
fs.unlinkSync(input);
let differ = 0, rejected = 0, panics = 0;
for (let i = 0; i < rows.length; i++) {
  const a = out.head[i], b = out.proto[i];
  if (a.split("\t")[1] === "err") rejected++;
  if (a.split("\t")[1] === "panic" || b.split("\t")[1] === "panic") panics++;
  if (a !== b) { differ++; console.log(`DIFFERS ${rows[i].loader} ${JSON.stringify(rows[i].src)}\n  head:  ${a}\n  proto: ${b}`); }
}
console.log(`${rows.length} parses without lint (${sources.size} sources as a.ts and as a.js): ${rejected} rejected by the head, ${panics} panics, ${differ} differ`);
