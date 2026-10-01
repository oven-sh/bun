const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, sentinel, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const decorators = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = [
  { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) },
  { ts: new Bun.Transpiler({ loader: "ts", tsconfig: decorators }), tsx: new Bun.Transpiler({ loader: "tsx", tsconfig: decorators }) },
];
const out = fs.openSync(outPath, "w");
function transform(index, config, loader, source) {
  fs.writeSync(out, JSON.stringify({ start: index, config }) + "\n");
  let result;
  try {
    result = { code: transpilers[config][loader].transformSync(source) };
  } catch (e) {
    result = { errors: (e?.errors ?? [e]).map(error => String(error?.message ?? error)) };
  }
  fs.writeSync(out, JSON.stringify({ index, config, ...result }) + "\n");
}
transform(-1, 0, "ts", sentinel);
for (const [index, file] of files) {
  const source = fs.readFileSync(root + "/" + file);
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  transform(index, 0, loader, source);
  if (/^[ \t]*@[A-Za-z_$(]/m.test(source.latin1Slice())) transform(index, 1, loader, source);
}
fs.closeSync(out);
