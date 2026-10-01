import { createRequire } from "node:module";
const require = createRequire("/workspace/bun/");
const ts = require("typescript");
const tm = new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
const srcs = [
  "class C {\n  @d m(a: any): a is string { return true }\n}\n",
  "class C {\n  @d m(a: any): this is C { return true }\n}\n",
  "class C {\n  @d m(a: any): asserts a {}\n}\n",
  "class C {\n  @d m(a: any): asserts a is string {}\n}\n",
  "class C {\n  @d m(a: any): asserts this {}\n}\n",
  "class C {\n  @d m(a: any): asserts this is C {}\n}\n",
  "class C {\n  @d p: this is C;\n}\n",
  "class C {\n  @d m(@d a: this is C) {}\n}\n",
];
for (const s of srcs) {
  let b; try { b = tm.transformSync(s).match(/design:returntype", ([^\n]*)\)|design:type", ([^\n]*)\)/g) } catch (e) { b = "ERR " + e.errors?.[0]?.message }
  const r = ts.transpileModule(s, { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strictNullChecks: false } });
  console.log(JSON.stringify(s)); console.log("  bun:", JSON.stringify(b)); console.log("  tsc:", JSON.stringify(r.outputText.match(/design:\w+", [^\n]*\)/g)));
}
