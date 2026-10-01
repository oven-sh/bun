const tm = new Bun.Transpiler({ loader: "ts", trimUnusedImports: true, tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) });
const srcs = [
  `import { Foo } from "./foo";\nclass X { @d p: Foo[] }`,
  `import { Foo } from "./foo";\nclass X { @d p: Foo }`,
  `import { Foo } from "./foo";\nclass X { @d p: keyof Foo }`,
  `import { Foo } from "./foo";\nclass X { @d p: readonly Foo[] }`,
  `import { Foo } from "./foo";\nclass X { @d p: Foo | string }`,
  `import { Foo } from "./foo";\nclass X { @d p: string | Foo }`,
  `import { Foo } from "./foo";\nclass X { @d p: any | Foo }`,
  `import { Foo } from "./foo";\nclass X { @d p: A extends Foo ? string : string }`,
  `import { Foo } from "./foo";\nclass X { @d p: Foo extends A ? string : string }`,
  `import { Foo } from "./foo";\nclass X { @d p: Bar<Foo> }`,
  `import { Foo } from "./foo";\nclass X { @d p: [Foo] }`,
  `import { Foo } from "./foo";\nclass X { @d p: { a: Foo } }`,
  `import { Foo } from "./foo";\nclass X { @d p: (a: Foo) => void }`,
  `import { Foo } from "./foo";\nclass X { @d p: (Foo) }`,
  `import { Foo } from "./foo";\nclass X { @d p: typeof Foo }`,
  `import { Foo } from "./foo";\nclass X { @d m(a: any): a is Foo { return true } }`,
  `import { a } from "./foo";\nclass X { @d m(a: any): a is string { return true } }`,
  `import { Foo } from "./foo";\nclass X { p: Foo }`,
];
for (const s of srcs) {
  const out = tm.transformSync(s);
  console.log(JSON.stringify(s.split("\n")[1]), "=>", out.includes('from "./foo"') ? "IMPORT KEPT" : "import dropped", "|", (out.match(/design:\w+", [^\n]*/g) ?? []).join(" ; "));
}
