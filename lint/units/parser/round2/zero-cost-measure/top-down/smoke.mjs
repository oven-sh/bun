const cases = [
  ["js", "const a = (1 + 2) * (b, c); f((x) => (y), async (z) => { await (z); });"],
  ["ts", "let g: (a = 1) => void; type as = 1; const v = <out>x; function f<T>(a: T, ...r: number[]): a is T { return (a as any)!; }"],
  ["tsx", "const e = <Foo<string> a={(1)}>{(x as number)}</Foo>;"],
  ["ts", "interface A<T> extends B<T>, C { a(x: number): void; readonly [k: string]: T; get b(): string }"],
];
let out = "";
for (const [loader, src] of cases) {
  try { out += new Bun.Transpiler({ loader }).transformSync(src); } catch (e) { out += "ERR " + String(e?.errors?.[0]?.message ?? e.message) + "\n"; }
}
console.log(Bun.hash(out).toString(36), out.length);
