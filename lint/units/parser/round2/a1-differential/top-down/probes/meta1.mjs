const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const t = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const srcs = [
  "class C { @d a: A extends B ? C : C }",
  "class C { @d a: C | C }",
  "class C { @d a: A extends B ? D : D }",
  "class C { @d a: D | D }",
  "class D {} class C { @d a: A extends B ? D : D }",
  "class D {} class C { @d a: D | D }",
  "class C { @d a: A extends B ? string : string }",
  "class C { @d a: A extends B ? C : string }",
  "class C { @d a: A extends B ? E.F : E.F }",
  "class C { @d a: E.F | E.F }",
];
for (const s of srcs) {
  let out;
  try { out = t.transformSync(s); } catch (e) { out = "ERR " + e.message; }
  const m = /design:type", ([^\n]*)\)\n/.exec(out);
  console.log(JSON.stringify(s), "=>", m ? m[1] : out);
}
