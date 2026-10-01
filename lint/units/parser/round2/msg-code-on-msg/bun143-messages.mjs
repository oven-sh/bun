const inputs = [
  ["ts", "import * ass x from 'y'"],
  ["ts", "export * as x frm 'y'"],
  ["ts", "import x frm 'y'"],
  ["ts", "\"abc"],
  ["ts", "/* abc"],
  ["ts", "`abc "],
  ["ts", "function f(...a, ) {}"],
  ["ts", "export { class };"],
  ["ts", "x = a ? b"],
  ["ts", "let x = 1 1;"],
  ["ts", "async function f() { for await (x in y) {} }"],
  ["tsx", "<a"],
];
for (const [loader, code] of inputs) {
  let out = [];
  try { new Bun.Transpiler({ loader }).transformSync(code); } catch (e) { out = (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`); }
  console.log(JSON.stringify(code), "[" + loader + "]");
  for (const b of out) console.log("   bun " + b);
  if (!out.length) console.log("   bun accepts");
}
console.log(Bun.version, Bun.revision);
