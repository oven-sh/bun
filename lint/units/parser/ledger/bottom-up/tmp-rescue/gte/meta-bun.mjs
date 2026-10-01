import fs from 'fs';
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const t = new Bun.Transpiler({ loader: 'ts', tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
function norm(s) {
  s = s.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^typeof ([\w$]+) === "undefined" \? Object : ([\w$.]+)$/.exec(s))) return (m[2] === 'Symbol' || m[2] === 'BigInt') ? m[2] : 'ref(' + m[2] + ')';
  if ((m = /^(typeof [\w$.]+ === "undefined" \|\| )+typeof ([\w$.]+) === "undefined" \? Object : ([\w$.]+)$/.exec(s))) return 'ref(' + m[3] + ')';
  if (s === 'undefined') return 'void0';
  return s;
}
function extract(out, key) {
  const re = new RegExp('__legacyMetadataTS\\w*\\("' + key + '", ');
  const mm = re.exec(out);
  if (!mm) return '<none>';
  let j = mm.index + mm[0].length, depth = 0, k = j;
  for (; k < out.length; k++) { const c = out[k]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') { if (depth === 0) break; depth--; } }
  return norm(out.slice(j, k));
}
const res = [];
for (const ty of inputs) {
  const row = { ty };
  for (const [pos, src, key] of [
    ['prop', `class Foo {}\nclass Bar {}\nclass C {\n  @d p: ${ty};\n}\n`, 'design:type'],
    ['ret', `class Foo {}\nclass Bar {}\nclass C {\n  @d m(x: any): ${ty} { return null as any }\n}\n`, 'design:returntype'],
  ]) {
    try { row['bun_' + pos] = extract(t.transformSync(src), key); } catch (e) { row['bun_' + pos] = 'ERR ' + (e?.errors ? e.errors.map(x => x.message).join(' | ') : String(e?.message ?? e)); }
  }
  res.push(row);
}
console.log(JSON.stringify(res));
