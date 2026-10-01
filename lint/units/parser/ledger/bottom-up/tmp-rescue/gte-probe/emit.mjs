import { createRequire } from "node:module";
const require = createRequire("/workspace/bun/");
const ts = require("typescript");
const t = new Bun.Transpiler({ loader: "ts" });
const inputs = [
  "let v = a < !b > (c)",
  "let v = a < import(b) > (c)",
  "let v = a < ?b > (c)",
  "class C extends B { m() { return a < super.b > (c) } }",
  "class C { m() { return a < this.b > (c) } }",
  "let v = a < b.c > (d)",
  "let v = a < asserts b > (c)",
  "let v = a < unique b > (c)",
  "let v = a < b.<c> > (d)",
  "let v = a < b<> > (c)",
  "let v = x as A ? -y : z",
  "let v = x as import('y') < z",
  "function f(keyof: any): keyof is string { return true }",
  "function f(asserts: any): asserts is string { return true }",
  "function f(a: any): asserts a\nis string {}",
  "type T = A extends [infer U extends B | C ? 1 : 2] ? 1 : 2; let q = 1",
  "type T = import('x')<A>; let q = 1",
  "let x: asserts a",
  "let x: unique A",
  "let x: A.<B>",
  "let x: import('x')<A>",
  "let v = x as asserts a",
  "type _break = [break: string]; let q = 1",
  "let x: Foo<> = {}",
  "const a: typeof #a = 1;",
];
for (const src of inputs) {
  let b;
  try { b = JSON.stringify(t.transformSync(src)); } catch (e) { b = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const pd = sf.parseDiagnostics.map(d => "TS" + d.code).join(",");
  const r = ts.transpileModule(src, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
  const diag = (r.diagnostics ?? []).map(d => "TS" + d.code).join(",");
  console.log(JSON.stringify(src));
  console.log("   bun:", b);
  console.log("   tsc:", JSON.stringify(r.outputText), pd ? "[parse " + pd + "]" : "", diag ? "[diag " + diag + "]" : "");
}
