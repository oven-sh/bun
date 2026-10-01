// usage: node rows-head.cjs test-rows.txt > rows.head-lint.txt
// What the lint parse of the head (probe binary, see lint-head.cjs) does with each row of test-rows.txt.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const rows = [];
let group = "";
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  if (line.startsWith("// ")) { group = line.slice(3); continue; }
  let m = /^\(b"((?:[^"\\]|\\.)*)", Loader::(\w+)(?:, (\d+), (\d+), (\d+), "((?:[^"\\]|\\.)*)")?\),/.exec(line);
  if (!m) continue;
  const text = JSON.parse('"' + m[1] + '"');
  rows.push({ group, text, loader: m[2].toLowerCase(), code: m[3] ? +m[3] : 0, start: +m[4], end: +m[5] });
}
const tmpIn = `/tmp/b4td/rows-in.${process.pid}.hex`, tmpOut = `/tmp/b4td/rows-out.${process.pid}.tsv`;
fs.writeFileSync(tmpIn, rows.map((r, id) => `${id} ${r.loader} ${Buffer.from(r.text, "utf8").toString("hex")}`).join("\n") + "\n");
const run = spawnSync("/tmp/smph/out/bun_js_parser", ["zz_probe"], { env: { ...process.env, SMPH_TLA: "1", SMPH_INPUTS: tmpIn, SMPH_OUT: tmpOut }, maxBuffer: 1 << 26 });
if (run.status !== 0) { console.error(String(run.stderr).slice(-2000)); process.exit(1); }
const unhex = h => Buffer.from(h ?? "", "hex").toString();
for (const line of fs.readFileSync(tmpOut, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); rows[Number(f[0])].lint = f.slice(1); }
fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
const summary = {};
group = null;
for (const r of rows) {
  if (r.group !== group) { group = r.group; console.log(`\n// ${group}`); }
  const f = r.lint;
  let head, key;
  if (f[0] === "ok") { head = "parses"; key = "parses"; }
  else if (f[0] === "panic") { head = "PANIC"; key = "PANIC"; }
  else {
    const msg = unhex(f[7]);
    head = `${JSON.stringify(msg)} @[${f[1]},${Number(f[1]) + Number(f[2])})` + (f[3] !== "0" ? ` => TS${f[3]} [${f[4]},${f[5]})` : " => no entry");
    key = msg.replace(/"[^"]*"/g, '"…"').replace(/Unexpected .*/, m => (m === 'Unexpected "…"' ? m : "Unexpected <token>")) + (f[3] !== "0" ? ` => TS${f[3]}` : " => no entry");
  }
  const passes = r.code === 0 ? f[0] === "ok" : f[0] !== "ok" && f[3] === String(r.code) && +f[4] === r.start && +f[5] === r.end;
  console.log(`${passes ? "pass" : "FAIL"} ${r.loader} ${JSON.stringify(r.text)}  want ${r.code ? `TS${r.code} [${r.start},${r.end})` : "parses"}  head: ${head}`);
  const k = `${group} || ${passes ? "pass" : "FAIL"} || ${key}`;
  summary[k] = (summary[k] ?? 0) + 1;
}
console.log("\n// summary: group || at the head || first message of the head");
for (const [k, v] of Object.entries(summary)) console.log(`// ${String(v).padStart(4)}  ${k}`);
