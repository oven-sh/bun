namespace M {
    export class C<T> { p: T; static s: number; #priv = 1; "quoted-name": string; 42: boolean; m(x: T): this { return this; } }
    export namespace N { export interface I { a: string; b?: number; readonly c: C<string>; } export type A = I | undefined; }
    export enum E { A, B = 2, "c-d" = 3 }
    export const enum CE { X = "x", Y = "y" }
    export function f<T extends string = "a">(x: T, y?: number, ...rest: boolean[]): T { return x; }
    export import Alias = N.I;
    class Hidden { h: number; }
    export var hidden: Hidden;
}
namespace M { export var merged: C<E>; }
interface Point { x: number; y: number; }
type Pair<A, B = A> = [first: A, second?: B];
type Fn = (this: Point, a: number, { b, c }: { b: string; c: boolean }, [d, e]: [number, number]) => void;
type Ctor = abstract new <T>(...args: T[]) => Point;
type Mapped<T> = { readonly [K in keyof T]?: T[K] };
type MappedAs<T> = { [K in keyof T as `get${K & string}`]: () => T[K] };
type Cond<T> = T extends (infer U extends string)[] ? U : T extends string ? "s" : never;
type Tpl<T extends string> = `a${T}b${number}`;
type Acc = Point["x"] | M.C<number>["p"];
type KO = keyof Point;
type TO = typeof M.f;
declare const sym: unique symbol;
declare function isPoint(x: unknown): x is Point;
declare function assertPoint(x: unknown): asserts x is Point;
declare function assertIt(x: unknown): asserts x;
declare function overloaded(x: string): string;
declare function overloaded(x: number): number;
declare function generic<T extends Point, U extends keyof T = keyof T>(t: T, u: U): T[U];
var obj = { a: 1, "b-c": "s", 3: true, [sym]: null, m(x: number) { return x; }, get g() { return 1; }, set g(v: number) {}, nested: { deep: [1, "two"] as const } };
var arrow = <T,>(x: T, y = 1) => ({ x, y });
var fe = function named(this: void, a?: string): asserts a {};
var ce = class Named<T> { v: T; };
var anonClass = class { static z = 0; };
var tuple: [a: string, b?: number, ...rest: boolean[]];
var ro: readonly string[];
var union: string | number | undefined | null | true | false | 1n | -2 | "x";
var inter: Point & { z: number } & (() => void);
var fnu: (() => void) | (new () => Point) | undefined;
var idx: { [key: string]: number; readonly [n: number]: 1; (): void; new (x: number): Point; };
var big: { aaaaaaaaaaaaaaaaaaaa: string; bbbbbbbbbbbbbbbbbbbb: string; cccccccccccccccccccc: string; dddddddddddddddddddd: string; eeeeeeeeeeeeeeeeeeee: string; ffffffffffffffffffff: string; gggggggggggggggggggg: string; hhhhhhhhhhhhhhhhhhhh: string; iiiiiiiiiiiiiiiiiiii: string; jjjjjjjjjjjjjjjjjjjj: string; kkkkkkkkkkkkkkkkkkkk: string; llllllllllllllllllll: string; };
var esc: "tab\there" | 'quote"d' | "uni\u00e9\u{1F600}" | `tpl${number}`;
function local() { class Inner { i: number; } var li: Inner; var lf = (q: Inner) => q; return li; }
