// usage: node all-diags-exp.cjs 'src' ...   as all-diags.cjs, with experimentalDecorators
const ts = require("/workspace/wt/parser/node_modules/typescript");
for (const s of process.argv.slice(2)) {
  const name = "input.ts";
  const host = ts.createCompilerHost({});
  host.getSourceFile = f => (f === name ? ts.createSourceFile(name, s, ts.ScriptTarget.Latest, true) : undefined);
  host.fileExists = f => f === name;
  host.readFile = f => (f === name ? s : undefined);
  const program = ts.createProgram([name], { noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], noEmit: true, strict: true, experimentalDecorators: true }, host);
  const file = program.getSourceFile(name);
  const all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].filter(d => ![2318, 2304, 7008, 7006].includes(d.code));
  console.log(JSON.stringify(s));
  for (const d of all) console.log(`   @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n").slice(0, 110)}`);
  if (!all.length) console.log("   nothing");
}
