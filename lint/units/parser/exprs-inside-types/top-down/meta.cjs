// design:type / design:paramtypes / design:returntype of tsc 6.0.2 and of the Bun binary that runs this script.
// usage: <bun> meta.cjs <inputs.txt>     one class member per line, e.g.  @d p: (a = 1) => void
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const pick = js => [...js.matchAll(/(?:__metadata|__legacyMetadataTS)\("design:(\w+)",\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g)].map(m => m[1] + "=" + m[2].replace(/\s+/g, " ")).join("; ");
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const src = `declare const d: any; declare const a: any, b: any;\nclass C {\n  ${line}\n}\n`;
  let t; try { t = pick(ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText); } catch (e) { t = "THROW"; }
  const pd = ts.createSourceFile("i.ts", src, ts.ScriptTarget.ESNext, true).parseDiagnostics.map(d => "TS" + d.code);
  let b; try { b = pick(new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) }).transformSync(src)); } catch (e) { b = "REJ " + String((e.errors ? e.errors[0] : e).message || e).slice(0, 60); }
  console.log(`${line}\n    tsc${pd.length ? " parse=[" + pd.join(",") + "]" : ""}: ${t}\n    bun: ${b}`);
}
