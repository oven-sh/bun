// usage: node corpus-lint.cjs <repo root> <probe binary A (head)> <probe binary B (prototype)>
// Runs the lint parse of both probe binaries over every .ts .tsx .mts .cts .js .jsx .mjs .cjs file under test/ and src/js,
// and prints each file whose result differs (ok against err, or another first error).
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const [root, binA, binB] = process.argv.slice(2);
const kinds = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx" };
function walkDir(dir, list) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return list; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, list);
    else if (kinds[path.extname(e.name)] !== undefined) list.push(p);
  }
  return list;
}
const files = [...walkDir(path.join(root, "test"), []), ...walkDir(path.join(root, "src/js"), [])];
const rows = [];
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(f); } catch { continue; }
  if (buf.length > 3_000_000) continue;
  const base = path.basename(f);
  const kind = /\.d\.(ts|mts|cts)$/.test(base) ? "dts" : kinds[path.extname(f)];
  rows.push({ id: rows.length, f: path.relative(root, f), kind, hex: buf.toString("hex") });
}
function run(bin, tag) {
  const out = new Map();
  for (let from = 0; from < rows.length; from += 1500) {
    const chunk = rows.slice(from, from + 1500);
    fs.writeFileSync(`/tmp/b3-corpus-${tag}.hex`, chunk.map(r => `${r.id} ${r.kind} ${r.hex}`).join("\n") + "\n");
    const p = spawnSync(bin, ["zz_probe"], { env: { ...process.env, SMPH_TLA: "1", SMPH_INPUTS: `/tmp/b3-corpus-${tag}.hex`, SMPH_OUT: `/tmp/b3-corpus-${tag}.tsv` }, maxBuffer: 1 << 26 });
    if (p.status !== 0) { console.error(tag, "chunk", from, "status", p.status, String(p.stderr).slice(-500)); }
    for (const line of fs.readFileSync(`/tmp/b3-corpus-${tag}.tsv`, "utf8").split("\n")) { if (!line) continue; const t = line.indexOf("\t"); out.set(Number(line.slice(0, t)), line.slice(t + 1)); }
  }
  return out;
}
const a = run(binA, "a");
const b = run(binB, "b");
const unhex = h => Buffer.from(h ?? "", "hex").toString();
let okA = 0, okB = 0, differ = 0, missing = 0;
for (const r of rows) {
  const x = a.get(r.id), y = b.get(r.id);
  if (x === undefined || y === undefined) { missing++; continue; }
  if (x === "ok") okA++;
  if (y === "ok") okB++;
  if (x !== y) {
    differ++;
    const show = s => { if (s === "ok" || s === "panic") return s; const f = s.split("\t"); return `${f[0]} @${f[1]}+${f[2]} ${JSON.stringify(unhex(f[7]).slice(0, 60))} TS${f[3]}`; };
    console.log(`${r.f}\n   A: ${show(x)}\n   B: ${show(y)}`);
  }
}
console.log(JSON.stringify({ files: rows.length, okA, okB, differ, missing }));
