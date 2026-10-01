const cases = process.argv.slice(2);
for (const src of cases) {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: true } } });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(src)); }
  catch (e) { out = "FAIL " + JSON.stringify(String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]); }
  console.log(JSON.stringify(src)); console.log("   -> " + out);
}
