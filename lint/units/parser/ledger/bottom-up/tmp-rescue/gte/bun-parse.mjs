// usage: bun bun-parse.mjs <json-array-file>
import fs from 'fs';
const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
const t = new Bun.Transpiler({ loader: 'ts' });
for (const src of inputs) {
  let ok = true, err = '', code = '';
  try { code = t.transformSync(src); } catch (e) { ok = false; err = (e?.errors ? e.errors.map(x => x.message).join(' | ') : String(e?.message ?? e)); }
  out.push({ src, ok, err, code });
}
console.log(JSON.stringify(out, null, 0));
