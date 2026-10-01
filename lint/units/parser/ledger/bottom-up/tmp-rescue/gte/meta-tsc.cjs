const ts = require('/workspace/bun/node_modules/typescript');
const fs = require('fs');
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function norm(s) {
  s = s.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^typeof \((_\w+) = typeof ([\w$]+) !== "undefined" && ([\w$.]+)\) === "function" \? \1 : Object$/.exec(s))) return 'ref(' + m[3] + ')';
  if ((m = /^typeof \((_\w+) = typeof ([\w$]+) !== "undefined" && \((_\w+) = ([\w$.]+)\) !== void 0 && \3\.([\w$]+)\) === "function" \? \1 : Object$/.exec(s))) return 'ref(' + m[4] + '.' + m[5] + ')';
  if (s === "void 0") return "void0";
  if (/^[A-Z][\w$]*$/.test(s) && !["Object","String","Number","Boolean","Array","Function","Symbol","BigInt","Promise"].includes(s)) return "ref(" + s + ")";
  return s;
}
function extract(out, key) {
  const i = out.indexOf('__metadata("' + key + '", ');
  if (i < 0) return '<none>';
  let j = i + ('__metadata("' + key + '", ').length, depth = 0, k = j;
  for (; k < out.length; k++) { const c = out[k]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') { if (depth === 0) break; depth--; } }
  return norm(out.slice(j, k));
}
const res = [];
for (const ty of inputs) {
  const row = { ty };
  for (const [name, strictNullChecks] of [['loose', false], ['strict', true]]) {
    for (const [pos, src, key] of [
      ['prop', `class Foo {}\nclass Bar {}\nclass C {\n  @d p: ${ty};\n}\n`, 'design:type'],
      ['ret', `class Foo {}\nclass Bar {}\nclass C {\n  @d m(x: any): ${ty} { return null as any }\n}\n`, 'design:returntype'],
    ]) {
      const sf = ts.createSourceFile('a.ts', src, ts.ScriptTarget.ESNext, true);
      const perr = sf.parseDiagnostics.length ? ' [TS' + sf.parseDiagnostics[0].code + ']' : '';
      let v;
      try {
        const r = ts.transpileModule(src, { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strictNullChecks }, reportDiagnostics: true });
        v = extract(r.outputText, key) + perr; } catch (e) { v = 'CRASH ' + String(e.message).split('\n').slice(0,2).join(' ').slice(0, 40); }
      row[name + '_' + pos] = v;
    }
  }
  res.push(row);
}
console.log(JSON.stringify(res));
