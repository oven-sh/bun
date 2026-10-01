// usage: bun probe.mjs <inputs.json> [--sem]   inputs: array of [name, loader, code]
// Prints, per input: Bun.Transpiler errors, tsc 6.0.2 parseDiagnostics, and with --sem the program's
// extra syntactic (JS-only TS8xxx) and semantic (grammar checks of the checker) diagnostics.
import { createRequire } from "node:module";
const require = createRequire("/workspace/wt/parser/package.json");
const ts = require("typescript");
const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
const withSem = process.argv.includes("--sem");
function bunErrors(code, loader) {
  try {
    new Bun.Transpiler({ loader }).transformSync(code);
    return [];
  } catch (e) {
    const list = e?.errors ?? [e];
    return list.map(m => {
      const p = m.position;
      return `${p ? `@${p.offset ?? "?"}+${p.length ?? "?"}` : "@?"} ${m.message}`;
    });
  }
}
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
function fmt(d) {
  return `@${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
}
function tsErrors(code, loader) {
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, false, kinds[loader]);
  return sf.parseDiagnostics.map(fmt);
}
const options = {
  noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
  allowJs: true, checkJs: false, strict: true, skipLibCheck: true, types: [], noLib: false,
  moduleDetection: ts.ModuleDetectionKind.Auto, experimentalDecorators: false,
};
const base = ts.createCompilerHost(options, true);
let oldProgram;
const noise = new Set([2304, 2552, 2307, 2503, 2339, 2322, 2345, 7006, 7005, 7034, 2454, 2695, 2365, 2362, 2363, 6133, 2792, 7016, 2580, 2693, 2749, 7031, 2531, 2532, 18048, 2769, 2554, 2551, 2448, 2630, 2588, 2540, 7053, 2872, 2873, 2869, 2871, 2774, 1345, 2367, 7026, 2591, 2694, 2315, 2344, 2314, 2300, 7008, 2355, 7010, 2378, 1208, 2686, 17004, 2874, 2875, 7027, 7028, 2349, 2351, 2488, 2461, 2548, 2585, 2581, 2584, 7022, 2502, 2741, 2739, 2740, 2556]);
function programDiags(code, loader) {
  const name = "/x." + loader;
  const host = {
    ...base,
    getSourceFile: (f, l) => (f === name ? ts.createSourceFile(f, code, l, true, kinds[loader]) : base.getSourceFile(f, l)),
    fileExists: f => f === name || base.fileExists(f),
    readFile: f => (f === name ? code : base.readFile(f)),
    getCurrentDirectory: () => "/",
    writeFile: () => {},
  };
  const program = ts.createProgram([name], options, host, oldProgram);
  oldProgram = program;
  const sf = program.getSourceFile(name);
  const parse = new Set(sf.parseDiagnostics.map(fmt));
  const syn = program.getSyntacticDiagnostics(sf).map(fmt).filter(s => !parse.has(s));
  let sem = [];
  try { sem = program.getSemanticDiagnostics(sf).filter(d => !noise.has(d.code)).map(fmt); } catch (e) { sem = ["(checker threw: " + String(e).slice(0, 80) + ")"]; }
  return { syn, sem };
}
for (const [name, loader, code] of inputs) {
  console.log(`--- ${name} [${loader}] ${JSON.stringify(code)}`);
  for (const l of bunErrors(code, loader)) console.log(`   bun: ${l}`);
  for (const l of tsErrors(code, loader)) console.log(`   tsc: ${l}`);
  if (withSem) {
    const { syn, sem } = programDiags(code, loader);
    for (const l of syn) console.log(`   syn: ${l}`);
    for (const l of sem) console.log(`   chk: ${l}`);
  }
}
