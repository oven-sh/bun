// usage: <bun under test> worker-min.js <list.json> <out.jsonl>   config 0: minify identifiers; config 1: minify everything
const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const options = [{ minify: { identifiers: true } }, { minify: { whitespace: true, syntax: true, identifiers: true } }, { target: "node", deadCodeElimination: false, trimUnusedImports: false }, { inline: true, trimUnusedImports: true, target: "bun" }];
const transpilers = options.map(o => ({ ts: new Bun.Transpiler({ loader: "ts", ...o }), tsx: new Bun.Transpiler({ loader: "tsx", ...o }) }));
const out = fs.openSync(outPath, "w");
const hash = bytes => Bun.hash(bytes).toString(16);
for (const [index, file] of files) {
  const source = fs.readFileSync(root + "/" + file);
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  for (let config = 0; config < options.length; config++) {
    fs.writeSync(out, JSON.stringify({ start: index, config }) + "\n");
    const record = { index, config };
    try {
      const code = transpilers[config][loader].transformSync(source);
      record.length = code.length;
      record.hash = hash(code);
    } catch (e) {
      record.errors = (e?.errors ?? [e]).map(error => String(error?.message ?? error));
    }
    fs.writeSync(out, JSON.stringify(record) + "\n");
  }
}
fs.closeSync(out);
