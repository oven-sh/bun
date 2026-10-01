// usage: <bun under test> corpus-bun.mjs <repo root> corpus.jsonl
// For each file that tsc reports a parse diagnostic for: does the parse pass of the running bun (scanImports) take it?
import path from "node:path";
const root = process.argv[2];
const rows = (await Bun.file(process.argv[3]).text()).split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => r.d);
const byCode = new Map();
for (const r of rows) {
  const ext = path.extname(r.f);
  const loader = ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : ext === ".ts" || ext === ".mts" || ext === ".cts" ? "ts" : "js";
  const text = await Bun.file(path.join(root, r.f)).text();
  let scan = "ok";
  try { new Bun.Transpiler({ loader }).scanImports(text); } catch (e) { scan = "ERR " + String((e?.errors ?? [e])[0]?.message).slice(0, 50); }
  const key = `TS${r.d[0]} ${scan === "ok" ? "bun parse pass: ok" : "bun parse pass: error"}`;
  if (!byCode.has(key)) byCode.set(key, []);
  byCode.get(key).push(`${r.f} @${r.d[1]}+${r.d[2]} ${r.d[3]}${scan === "ok" ? "" : "  || " + scan}`);
}
for (const [k, v] of [...byCode].sort()) { console.log(k, v.length); for (const line of v.slice(0, 40)) console.log("   ", line); }
