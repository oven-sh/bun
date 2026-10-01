import ts from "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./p1out.mjs", import.meta.url), "utf8");
const inputs = eval(src.slice(src.indexOf("const inputs = [") + 15, src.indexOf("];") + 1));
for (const s of inputs) {
  const sf = ts.createSourceFile("a.ts", s, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const d = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start).join(",");
  const out = d ? "ERR " + d : "OK  " + ts.transpileModule(s, { compilerOptions: { target: "esnext", module: "esnext" } }).outputText.trim().replace(/\s+/g, " ");
  console.log(JSON.stringify(s).padEnd(50), out);
}
