// usage: <bun under test> worker.js <list.json> <out.jsonl> [dump]
// list.json: { root, sentinel, files: [[index, path], ...] }. One line for each transform: the index, the configuration,
// the length and hash of the source, and the length and hash of the output or the messages of the errors.
const fs = require("node:fs");
const [listPath, outPath, dump] = process.argv.slice(2);
const { root, sentinel, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const decorators = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = [
  { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) },
  { ts: new Bun.Transpiler({ loader: "ts", tsconfig: decorators }), tsx: new Bun.Transpiler({ loader: "tsx", tsconfig: decorators }) },
];
const out = fs.openSync(outPath, "w");
const hash = bytes => Bun.hash(bytes).toString(16);
function transform(index, config, loader, source) {
  // The line before the result names the file that a crash is in.
  fs.writeSync(out, JSON.stringify({ start: index, config }) + "\n");
  const record = { index, config, sourceLength: source.length, sourceHash: hash(source) };
  const t0 = performance.now();
  try {
    const code = transpilers[config][loader].transformSync(source);
    record.length = code.length;
    record.hash = hash(code);
    if (dump) record.code = code;
  } catch (e) {
    record.errors = (e?.errors ?? [e]).map(error => String(error?.message ?? error));
  }
  record.ms = Math.round((performance.now() - t0) * 10) / 10;
  fs.writeSync(out, JSON.stringify(record) + "\n");
}
transform(-1, 0, "ts", Buffer.from(sentinel));
for (const [index, file] of files) {
  let source;
  try {
    source = fs.readFileSync(root + "/" + file);
  } catch {
    continue;
  }
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  transform(index, 0, loader, source);
  transform(index, 1, loader, source);
}
fs.closeSync(out);
