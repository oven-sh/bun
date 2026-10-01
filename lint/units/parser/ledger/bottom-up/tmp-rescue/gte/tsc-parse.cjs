// usage: node tsc-parse.cjs <file-with-one-snippet-per-line-or-json-array>
const ts = require('/workspace/bun/node_modules/typescript');
const fs = require('fs');
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const src of inputs) {
  const sf = ts.createSourceFile('a.ts', src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  out.push({ src, ok: diags.length === 0, diags });
}
console.log(JSON.stringify(out, null, 0));
