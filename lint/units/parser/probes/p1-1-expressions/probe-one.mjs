// usage: bun probe.mjs <inputs.json>   prints per input: tsc parse diags (ts, tsx), bun result (ts, tsx)
import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tr = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), js: new Bun.Transpiler({ loader: "js" }) };
const bun = (src, l) => { try { return "OK  " + tr[l].transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { return "ERR " + (e.errors?.[0]?.message ?? e.message).split("\n")[0]; } };
const isGrammarCode = code => code < 2000 || (code >= 8000 && code < 9000) || (code >= 17000 && code < 19000);
const tscParse = (src, tsx) => {
  const sf = ts.createSourceFile(tsx ? "/i.tsx" : "/i.ts", src, ts.ScriptTarget.ESNext, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start);
};
const tscGrammar = (src, tsx) => {
  const fileName = tsx ? "/i.tsx" : "/i.ts";
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve, noEmit: true };
  const host = { getSourceFile: (n, o) => n === fileName ? ts.createSourceFile(n, src, o, true) : undefined, getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: f => f === fileName ? src : undefined, directoryExists: () => true, getDirectories: () => [] };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const all = program.getSemanticDiagnostics(program.getSourceFile(fileName));
  return { grammar: all.filter(d => isGrammarCode(d.code)).map(d => "TS" + d.code + "@" + d.start), other: [...new Set(all.filter(d => !isGrammarCode(d.code)).map(d => "TS" + d.code))] };
};
const emit = (src, tsx) => ts.transpileModule(src, { fileName: tsx ? "i.tsx" : "i.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText.trim().replace(/\s+/g, " ");
console.log("bun", Bun.version, Bun.revision, "typescript", ts.version);
for (const src of inputs) {
  const p = tscParse(src, false), px = tscParse(src, true);
  let g = { grammar: [], other: [] };
  if (!p.length) { try { g = tscGrammar(src, false); } catch (e) { g = { grammar: ["THREW"], other: [] }; } }
  const cls = p.length ? "tsc-REJ" : g.grammar.length ? "tsc-GRAM" : "tsc-OK ";
  console.log(JSON.stringify(src));
  console.log("    ", cls, p.join(","), g.grammar.join(","), g.other.length ? "(also " + g.other.join(",") + ")" : "", px.join(",") === p.join(",") ? "" : " tsx:" + (px.join(",") || "ok"));
  if (!p.length) console.log("     tsc.js ", emit(src, false));
  console.log("     bun.ts ", bun(src, "ts"));
  const bx = bun(src, "tsx"); if (bx !== bun(src, "ts")) console.log("     bun.tsx", bx);
  if (process.env.JS) console.log("     bun.js ", bun(src, "js"));
}
