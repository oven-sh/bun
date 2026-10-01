import { createRequire } from "node:module";
const require = createRequire("/workspace/bun/");
const ts = require("typescript");
const tm = new Bun.Transpiler({
  loader: "ts",
  tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
});
const src = `
class A {}
class C {
  @d p: A | null;
  @d q: Foo.Bar;
  @d r: A extends B ? string : string;
  @d m(a: string, b: Q): Promise<void> { return null as any }
}
`;
console.log(tm.transformSync(src));
console.log(ts.transpileModule(src, {compilerOptions: {experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext}}).outputText);
