// usage: node diag.cjs "<source>" [tsx]   -> every diagnostic of a one-file program (noLib), unfiltered
const ts = require("/workspace/wt/parser/node_modules/typescript");
const src = process.argv[2].replace(/\\n/g, "\n"); const tsx = process.argv[3] === "tsx";
const name = tsx ? "input.tsx" : "input.ts";
const sf = ts.createSourceFile(name, src, ts.ScriptTarget.ESNext, true);
const options = { noLib: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, noEmit: true, types: [], experimentalDecorators: true };
const host = ts.createCompilerHost(options);
host.getSourceFile = f => (f === name ? sf : undefined); host.fileExists = f => f === name; host.readFile = f => (f === name ? src : undefined);
const prog = ts.createProgram([name], options, host);
for (const d of [...sf.parseDiagnostics.map(d => ["parse", d]), ...prog.getSemanticDiagnostics(sf).map(d => ["check", d])])
  console.log(d[0], "TS" + d[1].code, "@" + d[1].start, "+" + d[1].length, ts.flattenDiagnosticMessageText(d[1].messageText, " "));
