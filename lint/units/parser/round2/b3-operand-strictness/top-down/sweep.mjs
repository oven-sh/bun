// usage: <bun> sweep.mjs [/tmp/rr/parsediag-bu] > sweep.txt
// Builds expressions from a small grammar of operands, prefixes, postfixes and binary operators, as TypeScript and as
// JavaScript, and lists by kind those that the parse pass of the running bun (scanImports) takes and typescript-go
// rejects: the first diagnostic of typescript-go, the token it marks and the token before it.
import { spawnSync } from "node:child_process";
const goBin = process.argv[2] || "/tmp/rr/parsediag-bu";
const atoms = ["a", "a.b", "f()", "(a)", "1", "this"];
const pre = { js: ["-", "++", "typeof ", "await ", "new ", "!"], ts: ["-", "++", "typeof ", "await ", "new ", "<T>"] };
const post = { js: ["++", ".b", "[0]", "(1)", "`x`", "?.b", "--"], ts: ["++", ".b", "[0]", "(1)", "`x`", "?.b", "!", "<T>(1)", " as T"] };
const bin = [" + c", " = c", " += c", " ** c", " in c", ", c", " ? c : d", " || c", " = c = d"];
const exprs = { js: new Set(), ts: new Set() };
for (const l of ["js", "ts"]) {
  const level1 = [];
  for (const a of atoms) { level1.push(a); for (const p of post[l]) level1.push(a + p); }
  const level2 = [...level1];
  for (const e of level1) for (const p of post[l]) level2.push(e + p);
  const level3 = [...level2];
  for (const e of level2) for (const p of pre[l]) level3.push(p + e);
  for (const e of level1) for (const p of pre[l]) for (const q of pre[l]) level3.push(p + q + e);
  for (const e of level3) { exprs[l].add(e); for (const b of bin) exprs[l].add(e + b); }
}
const rows = [];
for (const l of ["js", "ts"]) for (const e of exprs[l]) rows.push({ l, e, s: `async function f() { ${e}; }` });
const input = rows.map((r, id) => JSON.stringify({ id, name: "input." + r.l, src: r.s })).join("\n") + "\n";
const p = spawnSync(goBin, [], { input, maxBuffer: 1 << 27 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) if (line) { const r = JSON.parse(line); go.set(r.id, r); }
const kinds = new Map();
// One transpiler for each loader: one for each input exhausts the memory.
const transpilers = { js: new Bun.Transpiler({ loader: "js" }), ts: new Bun.Transpiler({ loader: "ts" }) };
let both = 0, onlyBun = 0, onlyGo = 0, neither = 0;
rows.forEach((r, id) => {
  const d = (go.get(id).diags || [])[0];
  let bunErr = null;
  try { transpilers[r.l].scanImports(r.s); } catch (e) { const x = (e?.errors ?? [e])[0]; bunErr = x.message; }
  if (!d && !bunErr) { both++; return; }
  if (d && bunErr) { neither++; return; }
  if (!d && bunErr) { onlyGo++; const k = `the reference parses, bun: ${bunErr.replace(/"[^"]*"$/, '"…"')}`; const v = kinds.get(k) || { n: 0, ex: [] }; v.n++; if (v.ex.length < 4) v.ex.push(`[${r.l}] ${r.e}`); kinds.set(k, v); return; }
  onlyBun++;
  const token = r.s.slice(d[1], d[1] + d[2]);
  const before = r.s.slice(0, d[1]).trimEnd();
  const prev = /(\+\+|--|[\w$]+|\S)$/.exec(before)?.[1] ?? "";
  const cls = t => (/^(\+\+|--)$/.test(t) ? "update" : /^[+\-*/%&|^<>?]*=$/.test(t) && t !== "==" ? "assign" : /^[\w$]+$/.test(t) ? (/(^typeof$|^await$|^new$|^delete$|^void$)/.test(t) ? t : "word") : t);
  const k = [1005, 1109, 1128, 1003].includes(d[0]) ? `TS${d[0]} at ${JSON.stringify(cls(token))} after ${JSON.stringify(cls(prev))}` : `TS${d[0]} ${d[5].slice(0, 60)}`;
  const v = kinds.get(k) || { n: 0, ex: [] };
  v.n++; if (v.ex.length < 4) v.ex.push(`[${r.l}] ${r.e}`);
  kinds.set(k, v);
});
console.log(JSON.stringify({ inputs: rows.length, bothParse: both, bothReject: neither, bunParsesReferenceRejects: onlyBun, referenceParsesBunRejects: onlyGo }));
for (const [k, v] of [...kinds].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(v.n).padStart(6)}  ${k}    e.g. ${v.ex.join("   ")}`);
