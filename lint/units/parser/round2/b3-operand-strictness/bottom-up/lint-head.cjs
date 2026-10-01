// usage: node lint-head.cjs <inputs file>... > out
// What the lint parse of the head does with each source: the probe binary /tmp/smph/out/bun_js_parser (be1ebe5295 with zz_probe.rs,
// built by round2/strict-members-params-heritage/bottom-up/build-probe.sh) runs Parser::parse_for_lint_with_codes, top level await on as in `bun --lint`.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const inputs = [];
for (const file of process.argv.slice(2)) {
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
fs.writeFileSync("/tmp/b3-lint-in.hex", real.map(r => `${r.id} ${r.loader} ${Buffer.from(r.code, "utf8").toString("hex")}`).join("\n") + "\n");
const run = spawnSync("/tmp/smph/out/bun_js_parser", ["zz_probe"], { env: { ...process.env, SMPH_TLA: "1", SMPH_INPUTS: "/tmp/b3-lint-in.hex", SMPH_OUT: "/tmp/b3-lint-out.tsv" }, maxBuffer: 1 << 26 });
if (run.status !== 0) { console.error(String(run.stdout).slice(-2000), String(run.stderr).slice(-2000)); process.exit(1); }
const out = new Map();
for (const line of fs.readFileSync("/tmp/b3-lint-out.tsv", "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); out.set(Number(f[0]), f.slice(1)); }
const unhex = h => Buffer.from(h ?? "", "hex").toString();
const counts = {};
for (const i of inputs) {
  if (i.comment) { console.log(i.comment); continue; }
  const f = out.get(i.id) ?? ["missing"];
  let text;
  if (f[0] === "ok") text = "ok";
  else if (f[0] === "panic") text = "PANIC";
  else text = `${f[0]} @${f[1]}+${f[2]} ${JSON.stringify(unhex(f[7]))}` + (f[3] !== "0" ? `  => TS${f[3]} [${f[4]},${f[5]}) ${JSON.stringify(unhex(f[8]))}` : "  => no entry");
  counts[f[0]] = (counts[f[0]] ?? 0) + 1;
  console.log(`${i.loader.padEnd(3)} ${JSON.stringify(i.code)}  lint: ${text}`);
}
console.error(JSON.stringify(counts));
