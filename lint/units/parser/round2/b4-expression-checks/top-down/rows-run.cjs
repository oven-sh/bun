// usage: node rows-run.cjs <binary> <test-rows.txt> > rows.<variant>.txt
// What the lint parse of a scratch build (proto/build-scratch.sh) does with each row of test-rows.txt: pass where its first
// error has the code, the range and the text of the row, or where a row of a group "parses ..." parses.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [bin, file] = process.argv.slice(2);
const rows = [];
let group = "";
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (line.startsWith("// ")) { group = line.slice(3); continue; }
  const m = /^\(b"((?:[^"\\]|\\.)*)", Loader::(\w+)(?:, (\d+), (\d+), (\d+), "((?:[^"\\]|\\.)*)")?\),/.exec(line);
  if (!m) continue;
  rows.push({ group, text: JSON.parse('"' + m[1] + '"'), loader: m[2].toLowerCase(), code: m[3] ? +m[3] : 0, start: +m[4], end: +m[5], message: m[6] ? JSON.parse('"' + m[6] + '"') : "" });
}
const tmpIn = `/tmp/b4td/run-in.${process.pid}.hex`, tmpOut = `/tmp/b4td/run-out.${process.pid}.tsv`;
fs.writeFileSync(tmpIn, rows.map((r, id) => `${id} ${r.loader} ${Buffer.from(r.text, "utf8").toString("hex")}`).join("\n") + "\n");
const run = spawnSync(bin, ["zz_probe"], { env: { ...process.env, B4_INPUTS: tmpIn, B4_OUT: tmpOut }, maxBuffer: 1 << 26 });
if (run.status !== 0) { console.error(String(run.stdout).slice(-3000), String(run.stderr).slice(-3000)); process.exit(1); }
const unhex = h => Buffer.from(h ?? "", "hex").toString();
for (const line of fs.readFileSync(tmpOut, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); rows[Number(f[0])].lint = f.slice(1); }
fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
const summary = {};
group = null;
let failed = 0;
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log(`\n// ${group}`); }
  const f = r.lint ?? ["missing"];
  let got;
  if (f[0] === "ok") got = "parses";
  else if (f[0] === "panic" || f[0] === "missing") got = f[0].toUpperCase();
  else got = `${JSON.stringify(unhex(f[7]))} @[${f[1]},${Number(f[1]) + Number(f[2])})` + (f[3] !== "0" ? ` => TS${f[3]} [${f[4]},${f[5]}) ${JSON.stringify(unhex(f[8]))}` : " => no entry") + ` (${f[6]} messages)`;
  const passes = r.code === 0 ? f[0] === "ok" : f[0] === "err" && f[3] === String(r.code) && +f[4] === r.start && +f[5] === r.end && unhex(f[8]) === r.message;
  if (!passes) failed++;
  console.log(`${passes ? "pass" : "FAIL"} ${r.loader} ${JSON.stringify(r.text)}  want ${r.code ? `TS${r.code} [${r.start},${r.end})` : "parses"}  got: ${got}`);
  const k = `${passes ? "pass" : "FAIL"}  ${group}`;
  summary[k] = (summary[k] ?? 0) + 1;
}
console.log("\n// summary");
for (const [k, v] of Object.entries(summary)) console.log(`// ${String(v).padStart(4)}  ${k}`);
console.log(`// ${rows.length} rows, ${failed} failed`);
