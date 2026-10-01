declare let tl1: `a${string}`; declare let tl2: `a${number}`; declare let tl3: `b${string}`;
tl1 = tl2; tl2 = tl1; tl1 = tl3;
declare let up1: Uppercase<string>; declare let up2: Lowercase<string>;
up1 = "ABC"; up1 = "abc"; up1 = up2;
declare let tn: `${number}`; tn = "12"; tn = "x";
type IsStr<T> = T extends string ? "y" : "n";
function cond<T>(a: IsStr<T>, b: IsStr<T[]>) { a = b; const c: "y" | "n" = a; }
declare let x1: { a: string } & { b: number }; declare let x2: { a: string; b: string };
x2 = x1; x1 = x2;
declare let ov1: { (x: string): string; (x: number): number } | { (x: string): string; (x: number): number; extra: 1 };
ov1("s");
function over(x: string): string;
function over(x: number): number;
function over(x: boolean): any { return x; }
declare let pr1: (x: unknown) => x is string; declare let pr2: (x: unknown) => x is number; declare let pr3: (y: unknown, x: unknown) => x is string;
pr1 = pr2; pr1 = pr3;
class B0 { b = 1 } class D0 extends B0 { d = 2 }
function der(v: B0 | string) { if (v instanceof D0) { const q: number = v.d; } }
type Unwrap<T> = T extends { v: infer U } ? U : never;
declare function cinf<T>(x: Unwrap<T>): T;
declare function gm<T>(x: { [K in keyof T]: T[K] }, y: { [K in keyof T]: T[K][] }): T;
const gm1 = gm({ a: 1 }, { a: ["s"] });
declare function vt<T extends unknown[], U>(x: [...T, U]): [T, U];
const vt1 = vt([1, "a", true]);
declare function vt2<A, B>(x: [A, B], y: [A?, B?]): [A, B];
const vt3 = vt2([1, "a"], [2]);
declare function kf<T>(k: keyof T): T;
const kf1 = kf("a");
declare function iv<T>(x: T & { tag: string }): T;
const iv1 = iv({ tag: "t", v: 1 });
declare function dflt<T = number>(): T; const d1: string = dflt();
declare function ncb<T>(f: (a: T) => T, g: (a: T) => void): T;
const n1: string = ncb((a: number) => a, (a: 1) => {});
var idv: { (x: number): string; [k: string]: unknown };
var idv: { (x: string): string; [k: string]: unknown };
if ((1 as number | string) === (true as boolean)) {}
declare let e1: 1 | 2; declare let e2: 2 | 3; if (e1 === e2) {}
declare function pick<T, K extends keyof T>(o: T, ...k: K[]): Pick<T, K>;
const pk: { a: number } = pick({ a: 1, b: "s" }, "b");
