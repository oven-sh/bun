// usage: bun og.mjs <src>...   prints transpile output or error with the installed (old grammar) bun
const t = new Bun.Transpiler({ loader: "ts", target: "bun" });
const tm = new Bun.Transpiler({ loader: "ts", target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } });
for (const src of process.argv.slice(2)) {
  let out;
  try { out = "OK  " + JSON.stringify(t.transformSync(src)); } catch (e) { out = "ERR " + JSON.stringify(String(e.errors?.[0]?.message ?? e.message ?? e).slice(0, 120)); }
  console.log(JSON.stringify(src), "=>", out);
}
