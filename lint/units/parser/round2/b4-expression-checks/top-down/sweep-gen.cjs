// usage: node sweep-gen.cjs > sweep.hex
// Expressions from a small grammar of operands, prefixes, postfixes and binary operators that meet the checks of B4, each inside
// a method of a derived class with a private name, as TypeScript and as JavaScript: one line `<id> <ts|js> <hex of the source>`.
const atoms = ["a", "a.b", "f()", "(a)", "this", "super.x", "A"];
const post = {
  js: [".b", "?.b", ".#p", "?.#p", "[0]", "[]", "?.[0]", "?.()", "(1)", "++", "`x`"],
  ts: [".b", "?.b", ".#p", "?.#p", "[0]", "[]", "?.[0]", "?.()", "(1)", "++", "`x`", "<T>", "<T>(1)", "!"],
};
const pre = { js: ["-", "typeof ", "await ", "new ", "++", "!"], ts: ["-", "typeof ", "await ", "new ", "++", "<T>"] };
const bin = ["", " ** c", " + c", " = c"];
let id = 0;
const out = [];
for (const l of ["js", "ts"]) {
  const level1 = [];
  for (const a of atoms) { level1.push(a); for (const p of post[l]) level1.push(a + p); }
  const level2 = [...level1];
  for (const e of level1) for (const p of post[l]) level2.push(e + p);
  const level3 = [...level2];
  for (const e of level2) for (const p of pre[l]) level3.push(p + e);
  for (const e of level1) for (const p of pre[l]) for (const q of pre[l]) level3.push(p + q + e);
  const all = new Set();
  for (const e of level3) for (const b of bin) all.add(e + b);
  for (const e of all) out.push(`${id++} ${l} ${Buffer.from(`class K extends B { #p; async m(a) { ${e}; } }`, "utf8").toString("hex")}`);
}
process.stdout.write(out.join("\n") + "\n");
