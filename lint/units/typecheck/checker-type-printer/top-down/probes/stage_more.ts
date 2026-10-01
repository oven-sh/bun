declare function isS(x: unknown): x is string;
declare function isN(x: unknown): x is number;
declare function notPred(x: unknown): boolean;
let p1: typeof isS = isN;
let p2: typeof isS = notPred;
declare function mp<T>(): { [K in keyof T]: T[K] };
declare function mp2<T>(): { readonly [K in keyof T]?: K };
declare function mp3<T extends string>(): { [K in T as `x${K}`]-?: K };
declare function ds({ a, b: [c, , d = 1], ...rest }: { a: string; b: number[]; z: 1 }, [e, f]: [number, string]): void;
namespace NA { export function fn(): void {} export const k = class Named { p = 1; self(): Named { return this; } }; export enum En { "a-b" = 1, c = 2 } export type Al = { al: 1 } }
declare let nv: never;
nv = mp; nv = mp2; nv = mp3; nv = ds; nv = NA.fn; nv = NA.k; nv = new NA.k(); nv = NA.En["a-b"]; nv = NA.En.c; nv = NA.En;
declare const tup: [NA.Al, typeof NA.fn, NA.En, (typeof NA.k)["prototype"]];
nv = tup;
class Priv { #h = 1; private pr = 2; protected po = 3; static st = 4; [k: string]: unknown }
nv = new Priv(); nv = Priv;
declare const neg: { [-1]: 1; "-2": 2; 3: 3; "a b": 4; a$: 5; "": 6 };
nv = neg;
function ctx() { const local = { m() { return local; } }; nv = local; }
