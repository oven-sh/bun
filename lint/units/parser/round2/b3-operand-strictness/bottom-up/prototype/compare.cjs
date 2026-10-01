// usage: node compare.cjs <probe binary> <inputs file>... > out
// per source: the first parse diagnostic of typescript-go (byte offsets) against the entry of the first error of the lint parse of the probe binary.
// classes: same, DIFF (both reject, another code, range or text), MISSED (only the reference rejects), EXTRA (only the lint parse rejects), ok (both take it).
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const bin = process.argv[2];
const inputs = [];
for (const file of process.argv.slice(3)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    if (line.startsWith("#")) { inputs.push({ comment: line }); continue; }
    let loader = "ts", rest = line;
    const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
    if (m) { loader = m[1]; rest = m[2]; }
    inputs.push({ id: inputs.length, loader, code: JSON.parse(rest) });
  }
}
const real = inputs.filter(i => !i.comment);
const p = spawnSync("/tmp/rr/parsediag", ["-max", "2"], { input: real.map(r => JSON.stringify({ id: r.id, name: "input." + r.loader, text: r.code })).join("\n") + "\n", maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
const tag = process.pid;
fs.writeFileSync(`/tmp/b3-cmp-${tag}.hex`, real.map(r => `${r.id} ${r.loader} ${Buffer.from(r.code, "utf8").toString("hex")}`).join("\n") + "\n");
const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, SMPH_INPUTS: `/tmp/b3-cmp-${tag}.hex`, SMPH_OUT: `/tmp/b3-cmp-${tag}.tsv` }, maxBuffer: 1 << 26 });
if (run.status !== 0) { console.error(String(run.stdout).slice(-3000), String(run.stderr).slice(-3000)); process.exit(1); }
const out = new Map();
for (const line of fs.readFileSync(`/tmp/b3-cmp-${tag}.tsv`, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); out.set(Number(f[0]), f.slice(1)); }
const unhex = h => Buffer.from(h ?? "", "hex").toString();
const counts = {};
for (const i of inputs) {
  if (i.comment) { console.log(i.comment); continue; }
  const d = (go.get(i.id)?.d ?? [])[0];
  const f = out.get(i.id) ?? ["missing"];
  const lint = f[0] === "ok" ? null : f[0] === "panic" ? "PANIC" : [Number(f[3]), Number(f[4]), Number(f[5]) - Number(f[4]), unhex(f[8])];
  const show = x => x === null ? "parses" : x === "PANIC" ? "PANIC" : `TS${x[0]} @${x[1]}+${x[2]} ${JSON.stringify(x[3].length > 50 ? x[3].slice(0, 47) + "..." : x[3])}`;
  let cls;
  if (!d && lint === null) cls = "ok";
  else if (d && lint === null) cls = "MISSED";
  else if (!d) cls = "EXTRA";
  else cls = JSON.stringify(d) === JSON.stringify(lint) ? "same" : "DIFF";
  counts[cls] = (counts[cls] ?? 0) + 1;
  const bun = f[0] === "ok" || f[0] === "panic" ? "" : `   [bun: @${f[1]}+${f[2]} ${JSON.stringify(unhex(f[7]))}]`;
  console.log(`${cls.padEnd(6)} ${i.loader.padEnd(3)} ${JSON.stringify(i.code)}  go: ${show(d ?? null)}${cls === "same" || cls === "ok" ? "" : "  lint: " + show(lint) + bun}`);
}
console.error(JSON.stringify(counts));
