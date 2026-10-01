const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const tr = new Bun.Transpiler({ loader: "ts", tsconfig });
for (const code of [
  "declare const d: any;\nclass C { @d x: (a: number) => void; }",
  "declare const d: any;\nclass C { @d x: [a: number]; }",
  "declare const d: any;\nclass C { @d m(a: { b: number }, c: new () => C): (x: number) => void { return null! } }",
]) console.log(JSON.stringify(tr.transformSync(code)));
