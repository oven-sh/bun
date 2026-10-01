// usage: <bun under test> bun-parse.mjs <inputs file: one JSON string per line, optional prefix js:/tsx:/jsx:/ts:>
// per source: the parse pass alone (scanImports) and the full transform (transformSync) of the running bun
const lines = (await Bun.file(process.argv[2]).text()).split("\n").filter(l => l && !l.startsWith("#"));
for (const line of lines) {
  let loader = "ts", rest = line;
  const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
  if (m) { loader = m[1]; rest = m[2]; }
  const src = JSON.parse(rest);
  const t = new Bun.Transpiler({ loader });
  const run = f => {
    try { return ["ok", f()]; } catch (e) {
      return ["ERR " + (e?.errors ?? [e]).slice(0, 2).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`).join(" | ")];
    }
  };
  const [scan] = run(() => t.scanImports(src));
  const [full, out] = run(() => t.transformSync(src));
  console.log(`${JSON.stringify(src)} [${loader}]\n   parse: ${scan}\n   full:  ${full}${full === "ok" ? " => " + JSON.stringify(String(out).slice(0, 90)) : ""}`);
}
