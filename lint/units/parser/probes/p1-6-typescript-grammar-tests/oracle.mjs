// usage: bun oracle.mjs <rows.json> <out.json>
// rows.json: [{ which: "ts" | "tsx" | "deco" | ..., src, expected? }]
// Per row: the verdict of tsc 6.0.2 (parse diagnostics; grammar-range codes and other codes of a one-file program),
// the JavaScript of ts.transpileModule, that JavaScript printed by the bun that runs this script, and what the
// bun that runs this script does with the source.
import { readFileSync, writeFileSync } from "node:fs";
const ts = (await import(process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
  js: new Bun.Transpiler({ loader: "js" }),
  jsx: new Bun.Transpiler({ loader: "jsx" }),
};
const bun = (src, which) => {
  try {
    return { ok: true, out: transpilers[which].transformSync(src) };
  } catch (e) {
    const first = e && Array.isArray(e.errors) && e.errors.length ? e.errors[0] : e;
    return { ok: false, message: String(first?.message ?? first).split("\n")[0] };
  }
};
const isGrammar = c => c < 2000 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
function tsc(src, tsx, deco) {
  const fileName = tsx ? "/input.tsx" : "/input.ts";
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}`);
  if (parse.length) return { parse, grammar: [], other: [] };
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve, noEmit: true, experimentalDecorators: deco, emitDecoratorMetadata: deco };
  const host = {
    getSourceFile: (n, o) => (n === fileName ? ts.createSourceFile(n, src, o, true) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile() {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: f => f === fileName,
    readFile: f => (f === fileName ? src : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  let all;
  try {
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    const file = program.getSourceFile(fileName);
    all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
  } catch (e) {
    return { parse, grammar: ["THREW " + String(e.message).split("\n")[0]], other: [] };
  }
  return {
    parse,
    grammar: all.filter(d => isGrammar(d.code)).map(d => `TS${d.code}@${d.start}`),
    other: [...new Set(all.filter(d => !isGrammar(d.code)).map(d => d.code))],
  };
}
const tscJs = (src, tsx, deco) =>
  ts
    .transpileModule(src, {
      fileName: tsx ? "input.tsx" : "input.ts",
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, useDefineForClassFields: true, noEmitHelpers: true, experimentalDecorators: deco, emitDecoratorMetadata: deco },
    })
    .outputText.replace(/^"use strict";\n/, "");

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
for (const r of rows) {
  const loader = r.which.split(" ")[0];
  if (!transpilers[loader]) { out.push({ ...r, skip: true }); continue; }
  const tsx = loader === "tsx";
  const deco = loader === "deco";
  const verdict = tsc(r.src, tsx, deco);
  let js = null;
  let viaTsc = null;
  if (!verdict.parse.length) {
    try { js = tscJs(r.src, tsx, deco); } catch (e) { js = null; }
    if (js !== null) {
      viaTsc = bun(js, loader);
      if (!viaTsc.ok) viaTsc = bun(js, tsx ? "jsx" : "js");
    }
  }
  out.push({ ...r, tsc: verdict, tscJs: js, viaTsc, own: bun(r.src, loader) });
}
writeFileSync(process.argv[3], JSON.stringify({ bun: `${Bun.version} ${Bun.revision}`, typescript: ts.version, rows: out }, null, 1));
const n = { total: out.length, ownOk: 0, tscParseErr: 0, tscGrammar: 0, expectedDiffers: 0 };
for (const r of out) {
  if (r.skip) continue;
  if (r.own.ok) n.ownOk++;
  if (r.tsc.parse.length) n.tscParseErr++;
  if (r.tsc.grammar.length) n.tscGrammar++;
  if (typeof r.expected === "string" && r.viaTsc?.ok && r.viaTsc.out !== r.expected) n.expectedDiffers++;
}
console.log(`bun ${Bun.version} ${Bun.revision} typescript ${ts.version}`, JSON.stringify(n));
