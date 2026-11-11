// String(f) of a function in a .ts file is its source without the types. `<Foo>{}` behind an arrow would be a block with the type merely gone, and `return<number>a` a name.
// Plain Bun prints what its transpiler wrote, so the texts are not compared: each is evaluated, and has to do what the function does.
type Foo = { a?: number };
const functions = [
  () => <Foo>{},
  function (a: unknown) { return<number>a; },
  () => <Foo>{ a: 1 },
  (a: unknown) => typeof<any>a,
  () => (<any>function () { return 1; })(),
  () => (<any>class K {}).name,
  (a: any) => <number>a.b + 1,
  () => <Foo><unknown>{},
  function (a: any) { <any>{ x: a }.x; return 2; },
  (a: any) => (<any>a).b,
  (a: any) => { const made = <Foo>{ a: a.b }; return made; },
  (a: any) => [<Foo>{}, <number>a.b],
  (a: any) => void<any>a,
  async (a: any) => <Foo>{ a: await<any>a.b },
];
for (const made of functions) {
  const again = (0, eval)("(" + String(made) + ")");
  const [first, second] = [await (made as any)({ b: 3 }), await again({ b: 3 })];
  console.log(JSON.stringify(first), JSON.stringify(second));
}
