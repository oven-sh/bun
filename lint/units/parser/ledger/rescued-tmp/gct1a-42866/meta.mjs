// Usage: bun meta.mjs <types.txt>
// For each type T: class C { @d x: T }, emitDecoratorMetadata, compare design:type of Bun and tsc.
import { readFileSync } from "node:fs";
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const lines = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter(l => l.trim() && !l.startsWith("#"));
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const tr = new Bun.Transpiler({ loader: "ts", tsconfig });
function tag(out) {
  const m = out.match(/"design:type",\s*([^\n]*?)\)\s*\n?\s*\]/s) || out.match(/"design:type",\s*(.*?)\)[,\s]*\]/s);
  if (!m) return "<none>";
  return m[1].replace(/\s+/g, " ").trim();
}
let same = 0;
for (const raw of lines) {
  const T = raw.replaceAll("\\n", "\n");
  const code = `declare const d: any; class A {} class B {}\nclass C { @d x: ${T}; }`;
  let tscTag, bunTag;
  try {
    const r = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false },
      reportDiagnostics: true,
    });
    tscTag = (r.diagnostics?.length ? "PARSE-ERR " : "") + tag(r.outputText);
  } catch (e) {
    tscTag = "THROW " + e.message;
  }
  try {
    bunTag = tag(tr.transformSync(code));
  } catch (e) {
    bunTag = "ERR " + (e?.errors?.map(x => x.message).join("|") ?? e.message).slice(0, 80);
  }
  if (tscTag === bunTag) {
    same++;
    if (process.argv.includes("--all")) console.log(`same      ${raw}   => ${tscTag}`);
  } else console.log(`DIFF      ${raw}\n      tsc: ${tscTag}\n      bun: ${bunTag}`);
}
console.log(`${same} same of ${lines.length}`);
