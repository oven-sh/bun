const t = new Bun.Transpiler({ loader: 'ts', tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
const src = `
class Foo {}
class C {
  @d p: string | Foo;
  @d m(a: readonly Foo[], b: A.B.C): keyof Foo { return null as any }
}
`;
console.log(t.transformSync(src));
