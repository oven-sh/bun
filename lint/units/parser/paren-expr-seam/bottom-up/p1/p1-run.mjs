// usage: <bun-profile> p1-run.mjs <inputs.json> : prints one line per input: name, "OK <output>" or "ERR <first message>"
const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
for (const [name, loader, source] of inputs) {
  let out;
  try {
    out = "OK  " + new Bun.Transpiler({ loader, target: "bun" }).transformSync(source).trim().replace(/\n/g, " ");
  } catch (e) {
    const first = e?.errors?.[0] ?? e;
    out = "ERR " + String(first?.message ?? first).split("\n")[0];
  }
  console.log(name.padEnd(14), JSON.stringify(source).padEnd(52), out);
}
