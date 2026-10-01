const ts = require('/workspace/bun/node_modules/typescript');
const fs = require('fs');
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const options = { noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strict: false, types: [], skipLibCheck: true, moduleDetection: ts.ModuleDetectionKind.Force };
const host0 = ts.createCompilerHost(options);
const libCache = new Map();
for (const src of inputs) {
  const host = { ...host0,
    getSourceFile(name, lv) { if (name === 'a.ts') return ts.createSourceFile(name, src, lv, true); if (!libCache.has(name)) libCache.set(name, host0.getSourceFile(name, lv)); return libCache.get(name); },
    fileExists: n => n === 'a.ts' || host0.fileExists(n), readFile: n => n === 'a.ts' ? src : host0.readFile(n), writeFile() {} };
  const prog = ts.createProgram(['a.ts'], options, host);
  const sf = prog.getSourceFile('a.ts');
  const syn = prog.getSyntacticDiagnostics(sf), sem = prog.getSemanticDiagnostics(sf);
  const f = d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 90)}`;
  console.log(JSON.stringify(src) + '\n    syntactic: ' + (syn.map(f).join(' | ') || '-') + '\n    semantic:  ' + (sem.map(f).join(' | ') || '-'));
}
