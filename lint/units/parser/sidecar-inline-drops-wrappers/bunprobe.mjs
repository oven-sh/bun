// Runs each input through the transpiler of the bun that executes this file.
const files = process.argv.slice(2);
for (const f of files) {
  const inputs = JSON.parse(await Bun.file(f).text());
  for (const item of inputs) {
    const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
    const loader = file.endsWith(".tsx") ? "tsx" : file.endsWith(".js") ? "js" : file.endsWith(".jsx") ? "jsx" : "ts";
    let out;
    try {
      const t = new Bun.Transpiler({ loader, target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: false } } });
      out = "OK  " + JSON.stringify(t.transformSync(src).trim());
    } catch (e) {
      const msgs = (e.errors ?? [e]).map(x => (x.message ?? String(x)) + (x.position ? "@" + x.position.offset : ""));
      out = "ERR " + msgs.join(" | ");
    }
    console.log(JSON.stringify(src).padEnd(34) + " " + out);
  }
}
