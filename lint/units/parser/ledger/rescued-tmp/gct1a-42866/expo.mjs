import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const tr = new Bun.Transpiler({ loader: "ts" });
function gen(n) {
  let s = "1";
  for (let i = 0; i < n; i++) s = `a${i} < (b${i} = ${s})`;
  return "x = " + s + ";";
}
for (const n of [4, 8, 12, 14, 16, 18]) {
  const code = gen(n);
  let t0 = performance.now();
  const sf = ts.createSourceFile("a.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const t1 = performance.now();
  let bun = "ok";
  try { tr.transformSync(code); } catch (e) { bun = "ERR " + (e?.errors?.[0]?.message ?? e.message); }
  const t2 = performance.now();
  console.log(n, "tsc ms", (t1 - t0).toFixed(1), "diags", sf.parseDiagnostics.length, "| bun ms", (t2 - t1).toFixed(2), bun);
}
