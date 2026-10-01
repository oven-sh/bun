const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
const deco = process.env.DECO === "1";
for (const [name, text, file] of inputs) {
  const loader = (file || "a.ts").endsWith("x") ? "tsx" : "ts";
  const t = new Bun.Transpiler({ loader, target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: deco } } });
  let out;
  try { out = "OK   " + JSON.stringify(t.transformSync(text).trim()); }
  catch (e) { out = "FAIL " + JSON.stringify(String(e?.errors?.[0]?.message ?? e?.message ?? e).split("\n")[0]); }
  console.log(name.padEnd(34), out);
}
