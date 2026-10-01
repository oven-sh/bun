// usage: bun probe2.mjs <inputs.json> <out.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tr = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), js: new Bun.Transpiler({ loader: "js" }) };
const bun = (src, l) => { try { return "OK  " + tr[l].transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { return "ERR " + (e.errors?.[0]?.message ?? e.message).split("\n")[0]; } };
const isGrammarCode = code => code < 2000 || (code >= 8000 && code < 9000) || (code >= 17000 && code < 19000);
const tscParse = (src, tsx) => ts.createSourceFile(tsx ? "/i.tsx" : "/i.ts", src, ts.ScriptTarget.ESNext, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.map(d => "TS" + d.code + "@" + d.start);
const tscGrammar = (src, tsx) => {
  const fileName = tsx ? "/i.tsx" : "/i.ts";
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve, noEmit: true };
  const host = { getSourceFile: (n, o) => n === fileName ? ts.createSourceFile(n, src, o, true) : undefined, getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: f => f === fileName ? src : undefined, directoryExists: () => true, getDirectories: () => [] };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const all = program.getSemanticDiagnostics(program.getSourceFile(fileName));
  return { grammar: all.filter(d => isGrammarCode(d.code)).map(d => "TS" + d.code + "@" + d.start), other: [...new Set(all.filter(d => !isGrammarCode(d.code)).map(d => "TS" + d.code))] };
};
const emit = (src, tsx) => ts.transpileModule(src, { fileName: tsx ? "i.tsx" : "i.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText.trim().replace(/\s+/g, " ");
const lines = [];
for (const src of inputs) {
  const rec = { src };
  for (const d of ["ts", "tsx"]) {
    const p = tscParse(src, d === "tsx");
    let g = { grammar: [], other: [] };
    if (!p.length) { try { g = tscGrammar(src, d === "tsx"); } catch (e) { g = { grammar: ["THREW"], other: [] }; } }
    rec[d] = { parse: p, grammar: g.grammar, other: g.other, cls: p.length ? "REJ" : g.grammar.length ? "GRAM" : "OK", js: p.length ? null : emit(src, d === "tsx"), bun: bun(src, d) };
  }
  rec.bunjs = bun(src, "js");
  lines.push(JSON.stringify(rec));
}
writeFileSync(process.argv[3], lines.join("\n") + "\n");
console.log("bun", Bun.version, Bun.revision, "typescript", ts.version, "inputs", inputs.length);
