const ts = require("/workspace/wt/parser/node_modules/typescript");
for (const src of process.argv.slice(2)) {
  const name = "input.ts";
  const host = ts.createCompilerHost({});
  host.getSourceFile = f => (f === name ? ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true) : undefined);
  host.fileExists = f => f === name; host.readFile = f => (f === name ? src : undefined);
  const program = ts.createProgram([name], { noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], noEmit: true, strict: false }, host);
  const file = program.getSourceFile(name);
  const all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
  console.log(JSON.stringify(src), all.slice(0, 4).map(d => `@${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`).join(" | "));
}
