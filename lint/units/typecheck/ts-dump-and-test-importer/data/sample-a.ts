/** doc for f
 * @deprecated use g
 */
export function f<T>(a: T, b?: string, ...rest: number[]): void {}
namespace A.B.C { export const y = 1n; }
declare module "m" { }
declare global { }
module M { }
class K<T> extends Object implements I { private readonly x?: number; y!: string; constructor(public z = 1) { super(); } get w() { return 1 } static { } }
for (const k of [1,2,]) { }
for await (const k of []) { }
for (var i in {}) {}
switch (1) { case 1: break; default: }
let [p, , q] = [1, 2, 3];
let { r, s: { t } = {}, ...u } = {} as any;
const o = { a, b: 1, c = 2, ...d, e() {}, get f() { return 1 } };
import type { X } from "x";
import defer * as ns from "y";
import Z, { type W as V } from "z" with { type: "json" };
export * as q from "q";
export = f;
type Q = `a${string}b` | keyof T | readonly string[] | typeof import("z", { with: { "resolution-mode": "import" } });
let s1 = 'single', s2 = "dou\x41ble\u0041\u{42}", n1 = 0x10, n2 = 1_000, n3 = 010, n4 = 1e3, t1 = `x${1}y${2}z`, re = /a/g;
a?.b?.[c]?.(d)!;
x = <T>y; 
label: while (true) continue label;
enum E { A = 1, "B", C }
abstract class AC { abstract m(): void; declare q: number; accessor z = 1; @dec method() {} }
function g(this: Window, [a, b]: number[], {c}: any) { return arguments }
let v: ? = 1; let w: string? ; let fn: function(string): number;
