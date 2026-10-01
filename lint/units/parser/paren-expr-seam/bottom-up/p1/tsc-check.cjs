const ts = require('/workspace/wt/parser/node_modules/typescript');
const inputs = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
console.log('typescript', ts.version);
for (const [name, loader, source] of inputs) {
  const file = loader === 'js' ? 'a.js' : 'a.ts';
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, loader === 'js' ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics.map(d => 'TS' + d.code + '@' + d.start).join(' ');
  const out = ts.transpileModule(source, { fileName: file, compilerOptions: { target: 'esnext', module: 'esnext', allowJs: true } }).outputText.trim().replace(/\n/g, ' ');
  console.log(name.padEnd(14), (diags || 'ok').padEnd(22), out);
}
