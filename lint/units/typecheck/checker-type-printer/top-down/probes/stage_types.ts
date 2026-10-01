declare let nv: never;
interface Foo { a: string }
interface Gen<T, U = string> { t: T; u: U }
class C { x = 1; static s = 2 }
enum E { A, B, "quoted-member" = 5 }
const enum CE { X = "x" }
type Alias<T> = { al: T };
namespace NA { export interface Foo { na: 1 } export namespace Inner { export type T2 = { q: 1 } ; export class K {} } }
namespace NB { export interface Foo { nb: 1 } }
declare const usym: unique symbol;
declare function fn(x: number): string;
declare const v01: [any, unknown, string, number, bigint, boolean, symbol, void, undefined, null, never, object];
declare const v02: ["a", 1, -1, 1n, -1n, true, false, "a\nb\"c'", "é😀", 1e21, 0.1, -0];
declare const v03: [Foo, Gen<number>, Gen<number, boolean>, C, typeof C, E, E.A, typeof E, CE.X, Alias<string>, NA.Inner.T2, NA.Inner.K];
declare const v04: [string[], readonly string[], Array<string | number>, (() => void)[], (new () => Foo)[], (keyof Foo)[], (typeof usym)[], Foo["a"][], [a: string, b?: number, ...c: boolean[]], readonly [string, number?], [string, ...number[], boolean]];
declare const v05: [string | number, boolean | undefined, E | null, true | 1, Foo & C, (string | number) & Foo, keyof Foo, typeof fn, Foo["a"], typeof usym];
declare const v06: [NA.Foo, NB.Foo];
declare const v07: { k: `a${string}b${number}`; u: Uppercase<string>; p: Partial<Foo>; r: Record<string, number>; pr: Promise<string>; m: Map<string, number> };
type Cond<T> = T extends string ? "s" : T extends (infer U)[] ? U : never;
type Mapped<T> = { readonly [K in keyof T]?: T[K] };
type Mapped2<T> = { -readonly [K in keyof T as `get${string & K}`]-?: () => T[K] };
declare function g<T, K extends keyof T>(): [Cond<T>, Mapped<T>, Mapped2<T>, T[K], keyof T, T extends infer V extends string ? V : never];
nv = v01; nv = v02; nv = v03; nv = v04; nv = v05; nv = v06; nv = v07; nv = g;
