// usage: bun /tmp/gotg/probe.mjs <file with one input per line, \n escaped as \\n>  [--tsx] [--deco] [--out]
// Prints per input: bun result (ok + output, or error), tsc parse diagnostics, tsc program diagnostics (all codes
// except unresolved-name noise), tsc transpile output.
import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const tsx = args.includes("--tsx");
const deco = args.includes("--deco");
const showOut = args.includes("--out");
const lines = readFileSync(file, "utf8").split("\n").filter(l => l.length && !l.startsWith("#"));
const tsconfig = deco ? JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) : undefined;
const t = new Bun.Transpiler({ loader: tsx ? "tsx" : "ts", ...(tsconfig ? { tsconfig } : {}) });
const NOISE = new Set([2304, 2552, 2503, 2307, 2318, 2792, 2583, 2591, 2580, 2584, 2868, 2867, 2882, 2686, 2879, 17004, 6142, 7026, 2875, 2874]);
function tsc(src) {
  const fileName = tsx ? "/input.tsx" : "/input.ts";
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  let prog = [];
  let emitted = null;
  if (!parse.length) {
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve, noEmit: true, strict: false, experimentalDecorators: deco, emitDecoratorMetadata: deco, isolatedModules: false, verbatimModuleSyntax: false };
    const host = {
      getSourceFile: (f) => (f === fileName ? sf : undefined),
      getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f,
      useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: () => undefined,
    };
    const program = ts.createProgram([fileName], options, host);
    const all = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    prog = all.filter(d => !NOISE.has(d.code)).map(d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    const noise = all.filter(d => NOISE.has(d.code)).map(d => d.code);
    if (noise.length) prog.push("(noise " + [...new Set(noise)].join(",") + ")");
    try {
      emitted = ts.transpileModule(src, { fileName, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, experimentalDecorators: deco, emitDecoratorMetadata: deco, verbatimModuleSyntax: false, isolatedModules: true, useDefineForClassFields: true } }).outputText;
    } catch (e) { emitted = "EMIT THROW " + e.message; }
  }
  return { parse, prog, emitted };
}
for (const line of lines) {
  const src = line.replaceAll("\\n", "\n");
  let bun;
  try { bun = { ok: true, out: t.transformSync(src) }; }
  catch (e) { const list = e?.errors?.length ? e.errors : [e]; bun = { ok: false, err: list.map(x => `${x.message} @${x.position?.offset ?? "?"}`).join(" | ") }; }
  const r = tsc(src);
  const cls = bun.ok ? (r.parse.length ? "B " : (r.prog.filter(x => !x.startsWith("(noise")).length ? "AAg" : "AA ")) : (r.parse.length ? "RR " : (r.prog.filter(x => !x.startsWith("(noise")).length ? "A2 " : "A1 "));
  console.log(`${cls} ${JSON.stringify(src)}`);
  console.log(`     bun: ${bun.ok ? "ok" + (showOut ? " " + JSON.stringify(bun.out) : "") : bun.err}`);
  if (r.parse.length) console.log(`     tsc parse: ${r.parse.join(" ; ")}`);
  if (r.prog.length) console.log(`     tsc check: ${r.prog.join(" ; ")}`);
  if (showOut && r.emitted !== null) console.log(`     tsc emit: ${JSON.stringify(r.emitted)}`);
}
