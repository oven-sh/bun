const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const t = { js: new Bun.Transpiler({ loader: "js", macro: false }), jsx: new Bun.Transpiler({ loader: "jsx", macro: false }) };
const out = fs.openSync(outPath, "w");
for (const [index, file] of files) {
  let source; try { source = fs.readFileSync(root + "/" + file); } catch { continue; }
  if (source.length > 4_000_000) continue;
  fs.writeSync(out, JSON.stringify({ start: index, config: 0 }) + "\n");
  const record = { index, config: 0 };
  try { const code = t[file.endsWith(".jsx") ? "jsx" : "js"].transformSync(source); record.length = code.length; record.hash = Bun.hash(code).toString(16); }
  catch (e) { record.errors = (e?.errors ?? [e]).map(x => String(x?.message ?? x)).slice(0, 3); }
  fs.writeSync(out, JSON.stringify(record) + "\n");
}
fs.closeSync(out);
