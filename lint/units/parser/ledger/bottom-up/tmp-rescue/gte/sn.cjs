const ts = require('/workspace/bun/node_modules/typescript');
const src = `class C {\n  @d p: string | null;\n}\n`;
for (const o of [{}, {strict: false}, {strictNullChecks: false}, {strictNullChecks: true}, {strict: true}]) {
  const r = ts.transpileModule(src, { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, ...o } });
  console.log(JSON.stringify(o), /design:type", ([^)]*)\)/.exec(r.outputText)[1]);
}
