// Transforms each input with Bun.Transpiler and prints the output or the error.
const files = process.argv.slice(2);
for (const f of files) {
  const inputs = JSON.parse(await Bun.file(f).text());
  for (const { name, text, file } of inputs) {
    const loader = (file || "a.ts").endsWith(".tsx") ? "tsx" : (file || "a.ts").endsWith(".js") ? "js" : "ts";
    const t = new Bun.Transpiler({ loader, target: "bun", minifyWhitespace: false, deadCodeElimination: false, trimUnusedImports: false });
    let out;
    try { out = t.transformSync(text).trim().replace(/\n/g, " "); } catch (e) { out = "ERROR: " + (e?.errors?.map(x => x.message).join(" | ") || e?.message || String(e)).split("\n")[0]; }
    console.log(`${name}\t${JSON.stringify(text)}\t=> ${out}`);
  }
}
