const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
for (const [loader, src] of inputs) {
  const t = new Bun.Transpiler({ loader });
  let out;
  try {
    out = "OK   " + JSON.stringify(t.transformSync(src));
  } catch (e) {
    const errs = e.errors ?? [e];
    out = "ERR  " + errs.map(x => `${JSON.stringify(x.message)}@${x.position ? x.position.offset + "+" + x.position.length : "?"}`).join(" | ");
  }
  let scan;
  try {
    t.scanImports(src);
    scan = "scan OK";
  } catch (e) {
    const errs = e.errors ?? [e];
    scan = "scan ERR " + errs.map(x => `${JSON.stringify(x.message)}@${x.position ? x.position.offset + "+" + x.position.length : "?"}`).join(" | ");
  }
  console.log(`${loader.padEnd(3)} ${JSON.stringify(src)}\n      ${out}\n      ${scan}`);
}
