// A member that may be absent or null is called, or a method of it is, as the last thing an arrow function does and not as the last thing: a TypeError, never a crash.
declare const console: { log(...values: unknown[]): void };
class Inner { v: number; constructor(v: number) { this.v = v; } twice(): number { return this.v * 2; } }
interface Holder { maybe?: Inner; orNull: Inner | null; fn?: (x: number) => number; fnOrNull: ((x: number) => number) | null }
function tell(f: () => unknown): string { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
const full: Holder = { maybe: new Inner(2), orNull: new Inner(3), fn: x => x + 1, fnOrNull: x => x * 2 };
const empty: Holder = { orNull: null, fnOrNull: null };
for (const h of [full, empty, full, empty]) {
  console.log("last", tell(() => h.fn!(1)), tell(() => h.fnOrNull!(1)), tell(() => h.maybe!.twice()), tell(() => h.orNull!.twice()));
  console.log("not last", tell(() => { var r: number; r = h.fn!(1); return r; }), tell(() => { var r: number; r = h.fnOrNull!(1); return r; }), tell(() => { var r: number; r = h.maybe!.twice(); return r; }), tell(() => { var r: number; r = h.orNull!.twice(); return r; }));
  console.log("optional", tell(() => h.fn?.(1)), tell(() => h.fnOrNull?.(1)), tell(() => h.maybe?.twice()), tell(() => h.orNull?.twice()));
}
