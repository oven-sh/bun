const inputs = JSON.parse(await Bun.file(process.argv[2]).text());
for (const [name, loader, code] of inputs) {
  try { new Bun.Transpiler({ loader }).transformSync(code); }
  catch (e) { const list = e?.errors ?? [e]; console.log(name, "=>", list.map(m => m.message).join(" | ")); }
}
console.log("checked", inputs.length);
