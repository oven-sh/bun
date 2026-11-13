import { base } from "./dep.mjs";
function logged(value: any, context: any): any { (globalThis as any).decorated ??= []; (globalThis as any).decorated.push(context.kind + ":" + String(context.name)); if (context.kind === "method") return function (this: any, ...args: any[]) { return "<" + value.apply(this, args) + ">"; }; }
export class D { static n: number = base; #x = 1; @logged m(a: number) { return D.n + this.#x + a; } @logged static s() { return D.n; } @logged accessor acc = 4; @logged field = 5; }
@logged export class Dec { static self = 1; who() { return Dec.self; } }
export enum Kind { A = 1, B = A * 2, C = B + 3 }
namespace Space { export const inner = base + 1; export class In { static v = inner; get() { return In.v + inner; } } }
namespace Space { export let count = 0; export function bump() { count += inner; return count; } const local = { v: base }; export const read = () => local.v++ + count; }
namespace Deep.Er { export const x = base; export class Y { static z = x; get() { return Y.z + x; } } }
enum Kind2 { A = base as number, B = A + 1 }
export abstract class Abs { constructor(protected readonly p: number) {} abstract go(): number; static of(n: number) { return new Con(n); } }
export class Con extends Abs { go() { return this.p + Kind.C; } }
export function use() { const d = new D(); return [d.m(2), D.s(), d.acc, d.field, new Dec().who(), Kind.B, new Space.In().get(), Abs.of(3).go(), Space.bump(), Space.read(), Space.count, new Deep.Er.Y().get(), Kind2.B, Kind2[Kind2.A], (globalThis as any).decorated.join(",")].join(" "); }
