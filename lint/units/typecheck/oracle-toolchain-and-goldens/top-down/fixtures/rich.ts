interface Box<T> { value: T; map<U>(f: (x: T) => U): Box<U>; }
type Pair<A, B = A> = [A, B];
type Keys<T> = keyof T;
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };
type Cond<T> = T extends string ? "s" : T extends number ? "n" : never;
type Unwrap<T> = T extends Box<infer U> ? U : T;
enum E { A = 1, B, C = A | B, D = "d".length }
class Base { x = 1; get y(): string { return ""; } set y(v: string) {} }
class Derived<T extends object> extends Base { constructor(public t: T) { super(); } m(): this { return this; } }
declare function f<T>(x: T): T extends any[] ? T[number] : T;
const a: Pick2<{ p: number; q: string }, "p"> = { p: "x" };
const b: Cond<string | number | boolean> = "s";
const c: Unwrap<Box<number>> = "no";
const d: Pair<string> = ["a", 1];
const e: Keys<Base> = "z";
let g = f([1, "a"]);
const h: `id-${number}` = "id-x";
const i: Uppercase<"ab"> = "ab";
let j: E = E.C;
const k: E.A = j;
function over(x: string): number; function over(x: number): string; function over(x: any): any { return x; }
const l: string = over("a");
const { p, ...rest } = { p: 1, q: 2, r: "3" };
const m: { q: string } = rest;
let n = new Derived({ z: 1 }).m().t.z;
const o: string = n;
type U = string & { __brand: "u" } | number;
const q: U = true;
