const cases = [
  "let g: (a = 1) => void;", "type as = 1;", "const v = <out>x;", "let x: (a: ) => void;", "f<A | >(x);",
  "let a: A | B extends C ? D : E;", "interface I { a?: string; m<T>(x: T): void; [k: string]: any; get v(): number }",
  "let t: [a: string, b?: number, ...rest: boolean[]];", "type M = { readonly [K in keyof T]?: T[K] };",
  "function f(this: Window, a: typeof import('x')): asserts a is string {}", "let y = a as unknown as T<U>[]; let z = <T,>(x: T) => x;",
  "const a: typeof #a = 1;", "class C implements A.<B> {}", "let q: keyof typeof x[number]['a'];", "declare function f(x: number,): void;",
];
let out = [];
for (const src of cases) {
  try { out.push("ok " + new Bun.Transpiler({ loader: "ts" }).transformSync(src).length); } catch (e) { out.push("ERR " + String(e?.errors?.[0]?.message ?? e.message)); }
}
console.log(JSON.stringify(out));
