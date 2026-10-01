// usage: bun probe.mjs <inputs.txt: one input per line, "\n" written as \n, "#" starts a comment line> <out.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const inputs = [...new Set(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.length && !l.startsWith("#")).map(l => l.replaceAll("\\n", "\n")))];
const tr = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
const bun = (src, l) => { try { return "OK  " + tr[l].transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { return "ERR " + (e.errors?.[0]?.message ?? e.message).split("\n")[0]; } };
const isGrammarCode = code => code < 2000 || (code >= 8000 && code < 9000) || (code >= 17000 && code < 19000);
const tscParse = src => ts.createSourceFile("/i.ts", src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS).parseDiagnostics.map(d => "TS" + d.code + "@" + d.start);
const tscGrammar = src => {
  const fileName = "/i.ts";
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], noEmit: true };
  const host = { getSourceFile: (n, o) => n === fileName ? ts.createSourceFile(n, src, o, true) : undefined, getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: f => f === fileName ? src : undefined, directoryExists: () => true, getDirectories: () => [] };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const all = program.getSemanticDiagnostics(program.getSourceFile(fileName));
  return { grammar: all.filter(d => isGrammarCode(d.code)).map(d => "TS" + d.code + "@" + d.start), other: [...new Set(all.filter(d => !isGrammarCode(d.code)).map(d => "TS" + d.code))] };
};
const emit = src => ts.transpileModule(src, { fileName: "i.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false } }).outputText.trim().replace(/\s+/g, " ");
const lines = [];
for (const src of inputs) {
  const p = tscParse(src);
  let g = { grammar: [], other: [] };
  if (!p.length) { try { g = tscGrammar(src); } catch (e) { g = { grammar: ["THREW"], other: [] }; } }
  lines.push(JSON.stringify({ src, parse: p, grammar: g.grammar, other: g.other, cls: p.length ? "REJ" : g.grammar.length ? "GRAM" : "OK", js: p.length ? null : emit(src), bun: bun(src, "ts"), bunTsx: bun(src, "tsx") }));
}
writeFileSync(process.argv[3], lines.join("\n") + "\n");
console.log("bun", Bun.version, Bun.revision, "typescript", ts.version, "inputs", inputs.length);
