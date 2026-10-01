const rows = [
  ["ts", "x = a ? b"], ["ts", "f(1;"], ["ts", "function ("], ["ts", "function class() {}"], ["ts", "x = \"abc"], ["ts", "x = `abc"],
  ["ts", "let x = ;"], ["js", "let x = ;"], ["ts", "x = 1 +"], ["ts", "if (x) )"], ["ts", "in x"], ["ts", ")"], ["js", "{ ) }"],
  ["ts", "function f() { default }"], ["ts", "default"], ["ts", "catch (e) {}"], ["ts", "let x: ;"], ["ts", "function f(a: ) {}"], ["ts", "let x: A<;"],
  ["ts", "\"abc"], ["ts", "'abc\n x"], ["ts", "`abc "], ["ts", "/* abc"], ["ts", "// c\n/* abc"], ["js", "\"abc"], ["tsx", "\"abc"], ["ts", "  \"abc\r\nx"],
  ["ts", "let x: ( ;"], ["ts", "type T = { [: string]: b };"],
];
for (const [loader, code] of rows) {
  let out = [];
  try { new Bun.Transpiler({ loader }).scanImports(code); } catch (e) { out = (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`); }
  console.log(JSON.stringify(code), "[" + loader + "]", out.length ? out.join(" | ") : "ACCEPTS");
}
console.log(Bun.version, Bun.revision);
