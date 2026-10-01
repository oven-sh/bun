const ts = require('/workspace/bun/node_modules/typescript');
const src = `
class Foo {}
class C {
  @d p: string | Foo;
  @d m(a: readonly Foo[], b: A.B.C): keyof Foo { return null as any }
}
`;
for (const strictNullChecks of [false, true, undefined]) {
const r = ts.transpileModule(src, { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strictNullChecks }, reportDiagnostics: true });
console.log('--- strictNullChecks', strictNullChecks, r.diagnostics.length);
console.log(r.outputText);
}
