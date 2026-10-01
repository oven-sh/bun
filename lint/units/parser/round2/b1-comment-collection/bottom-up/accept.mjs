const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
for (const [name, loader, code] of inputs) {
  try { new Bun.Transpiler({ loader }).transformSync(code); } catch (e) { console.log("REJECT", name, loader, String(e?.message ?? e).split("\n")[0]); }
}
console.log("done", Bun.revision, inputs.length);
