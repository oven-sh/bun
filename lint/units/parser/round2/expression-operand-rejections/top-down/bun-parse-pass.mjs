// For each input: what the parse pass alone (scanImports) and the full transform (transformSync) of the running bun say.
const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
for (const entry of inputs) {
  const [name, text] = typeof entry === "string" ? ["a.ts", entry] : entry;
  const loader = name.endsWith(".tsx") ? "tsx" : name.endsWith(".js") ? "js" : "ts";
  const t = new Bun.Transpiler({ loader });
  const run = f => {
    try {
      f();
      return "ok";
    } catch (e) {
      const first = e.errors?.[0] ?? e;
      const pos = first.position ? `@${first.position.offset}+${first.position.length}` : "";
      return `ERR${pos} ${JSON.stringify(first.message ?? String(first))}`;
    }
  };
  const scan = run(() => t.scanImports(text));
  let out = "";
  const full = run(() => {
    out = t.transformSync(text);
  });
  console.log(`${JSON.stringify(text)}\n    parse: ${scan}\n    full:  ${full}${full === "ok" ? "  => " + JSON.stringify(out.slice(0, 80)) : ""}`);
}
