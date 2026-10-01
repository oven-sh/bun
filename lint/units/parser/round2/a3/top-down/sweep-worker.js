// usage: <bun> worker.js <list.json> <out.jsonl> <configs comma list>
const fs = require("node:fs");
const [listPath, outPath, configArg] = process.argv.slice(2);
const { root, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const EXP = JSON.stringify({ compilerOptions: { experimentalDecorators: true } });
const OPTIONS = {
  plain: {},
  deco: { tsconfig: DECO },
  exp: { tsconfig: EXP },
  min: { minify: { whitespace: true, syntax: true, identifiers: true } },
  keep: { deadCodeElimination: false, trimUnusedImports: false },
  trim: { trimUnusedImports: true },
};
const configs = configArg.split(",");
const transpilers = Object.fromEntries(configs.map(c => [c, { ts: new Bun.Transpiler({ loader: "ts", ...OPTIONS[c] }), tsx: new Bun.Transpiler({ loader: "tsx", ...OPTIONS[c] }) }]));
const out = fs.openSync(outPath, "w");
const t0 = performance.now(); const c0 = process.cpuUsage();
for (const file of files) {
  const source = fs.readFileSync(root + "/" + file);
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  for (const config of configs) {
    fs.writeSync(out, JSON.stringify({ start: file, config }) + "\n");
    let result;
    try {
      result = { code: transpilers[config][loader].transformSync(source) };
    } catch (e) {
      result = { errors: (e?.errors ?? [e]).map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null]) };
    }
    fs.writeSync(out, JSON.stringify({ file, config, ...result }) + "\n");
  }
}
const c1 = process.cpuUsage(c0);
fs.writeSync(out, JSON.stringify({ done: true, files: files.length, wallMs: Math.round(performance.now() - t0), cpuMs: Math.round((c1.user + c1.system) / 1000), rssMB: Math.round(process.memoryUsage.rss() / 1048576) }) + "\n");
fs.closeSync(out);
