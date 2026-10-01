// Spot probe for class members, heritage clauses and function declarations.
//
// usage: <bun binary> probe.mjs <inputs.json> [--emit]
//   inputs.json: an array of source strings, or of [label, source] pairs.
// Per input, one block: the verdict of tsc 6.0.2 (parse diagnostics; when the parse is clean the
// grammar-range codes and the other codes of a one-file program, without and with
// experimentalDecorators + emitDecoratorMetadata) and the result of the bun binary that runs this
// script (Bun.Transpiler transformSync, loader ts, without tsconfig and with the decorator tsconfig).
// --emit adds the text tsc emits (transpileModule, target and module esnext).
import { readFileSync } from "node:fs";
const ts = (await import(process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const args = process.argv.slice(2);
const emit = args.includes("--emit");
const file = args.find(a => !a.startsWith("--"));
const raw = JSON.parse(readFileSync(file, "utf8"));
const isGrammar = c => c < 2000 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 18000) || (c >= 18000 && c < 19000);
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const bunT = { plain: new Bun.Transpiler({ loader: "ts" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
function tscCheck(src, deco) {
  const fileName = "input.ts";
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noEmit: true, noLib: true, types: [], experimentalDecorators: deco, emitDecoratorMetadata: deco, noResolve: true };
  const host = ts.createCompilerHost(options, true);
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true);
  host.getSourceFile = name => (name === fileName ? sf : undefined);
  host.fileExists = n => n === fileName;
  host.readFile = n => (n === fileName ? src : undefined);
  host.writeFile = () => {};
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}`);
  if (parse.length) return `parse ${parse.join(" ")}`;
  const program = ts.createProgram([fileName], options, host);
  const all = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const grammar = all.filter(d => isGrammar(d.code)).map(d => `TS${d.code}@${d.start}`);
  const other = [...new Set(all.filter(d => !isGrammar(d.code)).map(d => d.code))].filter(c => c !== 2304 && c !== 2307);
  return `ok${grammar.length ? " grammar " + grammar.join(" ") : ""}${other.length ? " other " + other.join(",") : ""}`;
}
function bunRun(src, cfg) {
  try {
    return "ok " + JSON.stringify(bunT[cfg].transformSync(src));
  } catch (e) {
    const list = e?.errors?.length ? e.errors : [e];
    return "ERR " + JSON.stringify(String(list[0]?.message ?? list[0]));
  }
}
function tscEmit(src, deco) {
  const out = ts.transpileModule(src, { compilerOptions: { target: "esnext", module: "esnext", experimentalDecorators: deco, emitDecoratorMetadata: deco, useDefineForClassFields: true } });
  return JSON.stringify(out.outputText);
}
console.log(`# bun ${Bun.version} ${Bun.revision}  typescript ${ts.version}`);
for (const item of raw) {
  const [label, src] = Array.isArray(item) ? item : ["", item];
  const tp = tscCheck(src, false);
  const td = tscCheck(src, true);
  const bp = bunRun(src, "plain");
  const bd = bunRun(src, "deco");
  console.log(`${label ? label + "\t" : ""}${JSON.stringify(src)}`);
  console.log(`    tsc  ${tp}${td !== tp ? "   | deco: " + td : ""}`);
  console.log(`    bun  ${bp}${bd !== bp ? "\n    bun deco  " + bd : ""}`);
  if (emit) {
    const ep = tscEmit(src, false);
    const ed = tscEmit(src, true);
    console.log(`    tsc emit  ${ep}${ed !== ep ? "\n    tsc emit deco  " + ed : ""}`);
  }
}
