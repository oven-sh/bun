// usage (in the directory of the go-oracle output): node godiff.cjs <corpus> <ts|tsx>     where typescript-go and tsc 6.0.2 differ: parses or not, and the first diagnostic
const fs = require("fs"), zlib = require("zlib");
const [corpus, dialect] = process.argv.slice(2);
const oracle = zlib.gunzipSync(fs.readFileSync(`/workspace/notes/lint/units/parser/grammar-diff/oracle.${corpus}.jsonl.gz`)).toString("utf8").split("\n").filter(Boolean).slice(1);
const go = fs.readFileSync(`${corpus}.go.${dialect}.jsonl`, "utf8").split("\n").filter(Boolean);
let okDiffer = 0, firstDiffer = 0, same = 0, countDiffer = 0;
const ex = { ok: [], first: [] };
const kinds = new Map();
for (let i = 0; i < go.length; i++) {
  const o = JSON.parse(oracle[i]); const g = JSON.parse(go[i]);
  const t = o[dialect];
  const byte = u => Buffer.byteLength(o.src.slice(0, u), "utf8");
  if ((t.length === 0) !== (g.d.length === 0)) { okDiffer++; const k = `tsc ${t.length ? "TS" + t[0][0] : "ok"} / go ${g.d.length ? "TS" + g.d[0][0] : "ok"}`; if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(o.src); continue; }
  if (t.length === 0) { same++; continue; }
  if (t[0][0] !== g.d[0][0] || byte(t[0][1]) !== g.d[0][1] || byte(t[0][1] + t[0][2]) !== g.d[0][1] + g.d[0][2] || t[0][3] !== g.d[0][3]) { firstDiffer++; const k = `first: tsc TS${t[0][0]} / go TS${g.d[0][0]}` + (t[0][0] === g.d[0][0] ? (byte(t[0][1]) !== g.d[0][1] ? " other start" : t[0][3] !== g.d[0][3] ? " other text" : " other length") : ""); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(o.src + "   [tsc@" + byte(t[0][1]) + "+" + t[0][2] + " go@" + g.d[0][1] + "+" + g.d[0][2] + "]"); }
  else same++;
  if (t.length !== g.d.length) countDiffer++;
}
console.log(`${corpus} ${dialect}: ${go.length} sources; same verdict and first diagnostic ${same}; parse verdict differs ${okDiffer}; first diagnostic differs ${firstDiffer}; (count of diagnostics differs ${countDiffer})`);
for (const [k, v] of [...kinds].sort((a, b) => b[1].length - a[1].length)) { console.log(String(v.length).padStart(6), k); for (const s of v.slice(0, 3)) console.log("         ", JSON.stringify(s)); }
