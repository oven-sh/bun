const tm = new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
for (const ty of ["never", "void", "null", "undefined", "A extends B ? string : never", "bigint", "symbol", "A.B", "string"]) {
  const out = tm.transformSync(`class C {\n  @d p: ${ty};\n  @d m(a: ${ty}): ${ty} {}\n}\n`);
  console.log(JSON.stringify(ty), "=>", out.split("\n").filter(l => l.includes("design:") || /^\s+(typeof|String|undefined|Object|void)/.test(l)).map(s => s.trim()).join(" "));
}
