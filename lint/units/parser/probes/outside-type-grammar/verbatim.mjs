// usage: bun verbatim.mjs <inputs>   compares Bun and tsc output with verbatimModuleSyntax (imports/exports kept unless type-only)
import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const file = process.argv[2];
const lines = readFileSync(file, "utf8").split("\n").filter(l => l.length && !l.startsWith("#"));
const t = new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }) });
const norm = s => s.replace(/"use strict";\n/, "").replace(/\s+/g, " ").replace(/'/g, '"').replace(/;\s*$/,"").replace(/; /g,";").replace(/\{ \}/g,"{}").trim();
for (const line of lines) {
  const src = line.replaceAll("\\n", "\n");
  let bun;
  try { bun = t.transformSync(src); } catch (e) { const list = e?.errors?.length ? e.errors : [e]; bun = "ERROR " + list.map(x => x.message).join(" | "); }
  const sf = ts.createSourceFile("/input.ts", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let tsc;
  if (sf.parseDiagnostics.length) tsc = "PARSE ERROR " + sf.parseDiagnostics.map(d => "TS" + d.code).join(",");
  else tsc = ts.transpileModule(src, { fileName: "/input.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText;
  const same = norm(bun) === norm(tsc);
  console.log(`${same ? "SAME" : "DIFF"} ${JSON.stringify(src)}`);
  if (!same) { console.log(`     bun: ${JSON.stringify(bun)}`); console.log(`     tsc: ${JSON.stringify(tsc)}`); }
}
