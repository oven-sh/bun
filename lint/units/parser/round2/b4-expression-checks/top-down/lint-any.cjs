// usage: node lint-head.cjs <inputs module>... > out
// For each source of the groups, as a.ts and as a.js: the first parse diagnostic of typescript-go 89d5d5b (PARSEDIAG, default
// /tmp/rr/parsediag-bu), and what the lint parse of the head does: the probe binary /tmp/smph/out/bun_js_parser (be1ebe5295 with
// zz_probe.rs, built by round2/strict-members-params-heritage/bottom-up/build-probe.sh) runs Parser::parse_for_lint_with_codes.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const bin = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const probe = process.env.PROBE || "/tmp/smph/out/bun_js_parser";
const prefix = process.env.PROBE_ENV || "SMPH";
const rows = [];
for (const file of process.argv.slice(2)) {
  for (const [group, sources] of require(path.resolve(file))) for (const src of sources) for (const loader of ["ts", "js"]) rows.push({ group, src, loader });
}
const input = rows.map((r, id) => JSON.stringify({ id, name: "a." + r.loader, src: r.src })).join("\n") + "\n";
const go = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 28 });
if (go.status !== 0) throw new Error("parsediag failed: " + go.stderr);
for (const line of go.stdout.split("\n")) { if (!line) continue; const o = JSON.parse(line); rows[o.id].go = o.panic ? [["panic"]] : o.diags.map(d => [d[0], d[1], d[2], d[5]]); }
const tmpIn = `/tmp/b4td/lint-in.${process.pid}.hex`, tmpOut = `/tmp/b4td/lint-out.${process.pid}.tsv`;
fs.writeFileSync(tmpIn, rows.map((r, id) => `${id} ${r.loader} ${Buffer.from(r.src, "utf8").toString("hex")}`).join("\n") + "\n");
const run = spawnSync(probe, ["zz_probe"], { env: { ...process.env, [prefix + "_TLA"]: "1", [prefix + "_INPUTS"]: tmpIn, [prefix + "_OUT"]: tmpOut }, maxBuffer: 1 << 26 });
if (run.status !== 0) { console.error(String(run.stdout).slice(-2000), String(run.stderr).slice(-2000)); process.exit(1); }
const unhex = h => Buffer.from(h ?? "", "hex").toString();
for (const line of fs.readFileSync(tmpOut, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); rows[Number(f[0])].lint = f.slice(1); }
fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
const counts = {};
let group = null;
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log(`\n== ${group}`); }
  const f = r.lint ?? ["missing"];
  const ref = r.go.length ? `TS${r.go[0][0]} [${r.go[0][1]},${r.go[0][1] + r.go[0][2]})` + (r.go.length > 1 ? ` (+${r.go.length - 1})` : "") : "parses";
  let lint;
  if (f[0] === "ok") lint = "parses";
  else if (f[0] === "panic") lint = "PANIC";
  else lint = `${f[0] === "err" ? "" : f[0] + " "}${JSON.stringify(unhex(f[7]))} @[${f[1]},${Number(f[1]) + Number(f[2])})` + (f[3] !== "0" ? ` => TS${f[3]} [${f[4]},${f[5]})` : " => no entry");
  let cls;
  if (!r.go.length) cls = f[0] === "ok" ? "both-parse" : "LINT-REJECTS-ONLY";
  else if (f[0] === "ok") cls = "LINT-ACCEPTS";
  else if (f[3] === String(r.go[0][0]) && Number(f[4]) === r.go[0][1] && Number(f[5]) === r.go[0][1] + r.go[0][2]) cls = "same";
  else if (f[3] === String(r.go[0][0])) cls = "code-same-range-differs";
  else cls = "DIFFERS";
  counts[cls] = (counts[cls] ?? 0) + 1;
  console.log(`${r.loader} ${JSON.stringify(r.src)}\n     ref: ${ref}\n     lint: ${lint}    [${cls}]`);
}
console.error(JSON.stringify(counts));
