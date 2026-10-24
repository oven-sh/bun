// Enums (computed, merged, const, negative, fractional, with duplicate values and odd names, changed through any) and namespaces (merged, nested, dotted, over functions, classes and enums, with destructured exports, import aliases and shadowed names).
function show(label: string, f: () => unknown) {
    try { console.log(label, JSON.stringify(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
// enums
enum A { X, Y = 5, Z, W = "w", V = 1 << 3, U = V | Y, T = "a".length, S = -1, R = ~0, Q = Y * 2 + Z, P = `t${1}` as any, }
show("enum object", () => [Object.keys(A), Object.values(A)]);
enum Merge { A = 1 } enum Merge { B = A + 1, C = Merge.A + 10 }
show("merged enum", () => [Merge, Merge[2], Merge.C]);
const enum CE { A = 1, B = A << 4, C = "c" }
show("const enum", () => [CE.A, CE.B, CE.C, CE["B"]]);
enum Self { A = 1, B = Self.A + 1, C = Self["B"] * 3 }
show("self enum", () => Self);
let side = 0; function next() { return ++side; }
enum Computed { A = next(), B = next() * 10, C = "x".charCodeAt(0) }
show("computed enum", () => [Computed, side]);
enum Neg { A = -1, B, C } show("negative enum", () => [Neg, Neg[-1], Neg[0]]);
enum Fl { A = 0.5, B, C = 1e21, D = NaN, E = Infinity, F = -Infinity } show("float enum", () => [Object.keys(Fl), Fl.B, Fl[0.5], Fl[1e21], Fl[NaN], Fl["Infinity"], Fl["-Infinity"]]);
enum Dup { A = 1, B = 1, C = 2 } show("duplicate values", () => [Dup, Dup[1]]);
enum Names { toString = 1, constructor = 2, __proto__ = 3, length = 4, name = 5 } show("odd names", () => [Object.keys(Names), Names.toString, Names.constructor, Names[3], (Names as any).__proto__ === 3, Names.length]);
show("enum in enum scope", () => { const X = 100; enum In { X = 1, Y = X + 1 } return [In, X]; });
show("enum as value", () => { const e = A; const k: keyof typeof A = "Y"; return [e[k], e[e.Y], typeof e, Object.isFrozen(e)]; });
show("enum mutated", () => { (Dup as any).D = 9; (Dup as any).A = 7; const r = [Dup.A, (Dup as any).D, Dup[1]]; return r; });
// namespaces
namespace N { export const a = 1; export let b = 2; const hidden = 3; export function f() { return a + b + hidden; } export function setB(v: number) { b = v; } export class C { v = a; } export namespace Inner { export const deep = a + 10; } export enum E { P = 4 } }
show("namespace", () => [Object.keys(N), N.f(), (N.setB(20), N.b), N.f(), new N.C().v, N.Inner.deep, N.E.P]);
namespace N { export const later = a + b; export function g() { return f() + later; } }
show("merged namespace", () => [Object.keys(N), N.later, N.g()]);
show("namespace store from outside", () => { N.b = 100; return [N.b, N.f()]; });
function Fn() { return "fn"; } namespace Fn { export const extra = 5; export function helper() { return Fn() + extra; } }
show("function namespace", () => [Fn(), Fn.extra, Fn.helper(), Object.keys(Fn)]);
class Cl { static s = 1; m() { return Cl.extra; } } namespace Cl { export const extra = Cl.s + 1; }
show("class namespace", () => [Cl.extra, new Cl().m(), Object.keys(Cl)]);
enum En { A = 1 } namespace En { export function parse(s: string) { return En[s as keyof typeof En]; } }
show("enum namespace", () => [En.parse("A"), Object.keys(En)]);
namespace Empty { export type T = number; export interface I { x: T } } 
show("type-only namespace", () => typeof (globalThis as any).Empty);
namespace Dotted.Deep.Er { export const v = 1; } show("dotted namespace", () => Dotted);
namespace Shadow { export const x = 1; export function f(x: number) { return x; } export function g() { const x = 5; return x; } export function h() { return x; } }
show("shadowed export", () => [Shadow.f(9), Shadow.g(), Shadow.h()]);
namespace Destr { export const { p, q: [r, ...s] } = { p: 1, q: [2, 3, 4] }; export const [t = 7] = [] as number[]; } show("destructured exports", () => Destr);
namespace Alias { import I = N.Inner; export const v = I.deep; import fAlias = N.f; export const w = fAlias(); } show("import alias", () => Alias);
namespace Loop { export let i = 0; for (i = 0; i < 3; i++) {} export var j = i * 2; } show("namespace loop", () => Loop);
namespace Hoist { export const before = typeof later; export function later() {} } show("hoisted in namespace", () => Hoist);
