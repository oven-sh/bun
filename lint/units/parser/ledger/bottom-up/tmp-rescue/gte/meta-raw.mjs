const t = new Bun.Transpiler({ loader: 'ts', tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
for (const ty of ["never", "string", "Foo", "A.B", "symbol", "bigint", "Foo extends Bar ? never : string"]) {
  const out = t.transformSync(`class C {\n  @d p: ${ty};\n  @d m(a: ${ty}): ${ty} {}\n}\n`);
  console.log("=== " + ty + "\n" + out.split("\n").filter(l => /design:/.test(l) || /^\s+(typeof|Object|String|Number|void|undefined|\])/.test(l)).join("\n"));
}
