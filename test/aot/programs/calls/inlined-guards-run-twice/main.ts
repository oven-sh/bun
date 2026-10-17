// The first test of a function (a flag, a cached field, a null check) is inlined at its call sites; it is not observable that it runs again inside the function.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const log: string[] = [];
function pad(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += x + i; s ^= i; s += x * 2; s -= i; s |= 0; s += 7; s ^= x; s += 11; s -= 3; s += x & 5; s ^= 9; s += 13; s -= x >> 1; s += 17; } return s; }
// The shapes it is for: a flag test, a cached field, null or undefined.
interface T { flags: number; cached: T | undefined; id: number }
let made = 0;
function reduced(t: T): T { if (!(t.flags & 4)) return t; return t.cached || (t.cached = { flags: t.flags & ~4, cached: undefined, id: ++made + pad(t.id) * 0 }); }
function idOf(t: T | undefined): number { if (!t) return -1; if (t.id) return t.id; log.push("i"); t.id = ++made; return t.id + pad(1) * 0 + pad(2) * 0 + pad(3) * 0; }
// A class with an accessor that the first test reads: it must run once per call.
class Counted { reads = 0; private _v = 1; get v(): number { this.reads++; return this._v; } set v(n: number) { this._v = n; } }
function headWithAccessor(c: Counted): number { if (c.v > 1) return c.v; log.push("c"); c.v = c.v + 1; return pad(4) + pad(5) + pad(6); }
// `as` and `!` in the head.
interface A { kind: "a"; a: number } interface B { kind: "b"; b: string }
function headWithCast(x: A | B): number { if ((x as A).a > 0) return (x as A).a; log.push("k"); return pad(7) + pad(8) + pad(9); }
function headWithNonNull(t: T | undefined): number { if (!(t!.flags & 2)) return t!.id; log.push("n"); return pad(10) + pad(11) + pad(12); }
// A module variable that the rest changes, read in the head.
let state = 0;
function headReadsState(): number { if (!(state & 1)) return state++; log.push("s" + state); state += 1; return pad(state) * 0 + state + pad(13) * 0 + pad(14) * 0; }
// Under a handler, in a loop, two deep.
function outer(t: T | undefined): number { return idOf(t) + idOf(t); }
function outermost(t: T | undefined): number { try { return outer(t) + headWithNonNull(t); } catch (e: any) { return -100 - String(e.constructor.name).length; } }
function attempt(f: () => unknown): unknown { try { return f(); } catch (e: any) { return e.constructor.name; } }
for (let round = 0; round < 3; round++) {
  m.log.length = 0; console.log(m.run());
  log.length = 0; const out: unknown[] = [];
  const plain: T = { flags: 1, cached: undefined, id: 0 }, union: T = { flags: 5, cached: undefined, id: 7 };
  out.push(reduced(plain) === plain, reduced(union) === union, reduced(union) === reduced(union), reduced(union).flags, idOf(undefined), idOf(plain), idOf(plain), idOf(union));
  const c = new Counted(); out.push(headWithAccessor(c), c.reads, headWithAccessor(c), c.reads);
  out.push(headWithCast({ kind: "a", a: 3 }), headWithCast({ kind: "a", a: 0 }), attempt(() => headWithCast({ kind: "b", b: "s" })), headWithNonNull(plain), headWithNonNull({ flags: 2, cached: undefined, id: 9 }), attempt(() => headWithNonNull(undefined)));
  out.push(headReadsState(), headReadsState(), headReadsState(), state, outermost(plain), outermost({ flags: 0, cached: undefined, id: 0 }), outermost(undefined));
  console.log(out.join(), log.join(""));
}
export {};
