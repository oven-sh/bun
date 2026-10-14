// Direct calls of large functions with a rest parameter.
declare const console: any;
const kept: unknown[][] = [];
class Point { constructor(public x: number, public name: string) {} }
// Each is padded over the inliner's limit by a loop of cold work that does nothing for n = 0.
function pad(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += i * 3; s ^= i << 2; s += s % 7; s -= i & 5; s += (s >> 3) + (i | 9); s ^= s * 31; s += i % 11; s -= s & 255; s += i * i; s ^= s >>> 5; s += (i + 1) * 13; s -= s % 17; s ^= i * 7; s += s & 63; s -= i >> 1; s += s % 29; s ^= i + 19; s += (s | 3) - i; s -= s % 5; s ^= s << 1; } return s; }
function lengthOnly(...r: unknown[]): number { return r.length + pad(0); }
function reads(a: number, ...r: unknown[]): string { return a + ":" + r.length + ":" + String(r[0]) + ":" + String(r[1]) + ":" + String(r[r.length - 1]) + pad(0); }
function loops(...r: number[]): number { let s = pad(0); for (let i = 0; i < r.length; i++) s += r[i]; return s; }
function escapes(...r: unknown[]): unknown[] { pad(0); kept.push(r); return r; }
function mutates(...r: unknown[]): string { pad(0); r[0] = "m"; r.push("p"); return r.join(); }
function forwards(...r: unknown[]): string { pad(0); return reads(1, ...r); }
function iterates(...r: string[]): string { let s = "" + pad(0); for (const x of r) s += x; return s; }
function ofInteger(a: number, ...r: unknown[]): number { return (a | 0) + r.length + pad(0); }
function ofDouble(a: number, b: number, ...r: unknown[]): number { return a * b + r.length + pad(0); }
function ofBoolean(a: boolean, ...r: unknown[]): string { return (a ? "t" : "f") + r.length + pad(0); }
function ofString(a: string, ...r: unknown[]): string { return a + r.length + pad(0); }
function ofReference(a: Point, ...r: unknown[]): string { return a.name + a.x + r.length + pad(0); }
function ofOptional(a?: number, ...r: unknown[]): string { return String(a) + r.length + pad(0); }
function ofUnion(a: string | symbol, ...r: unknown[]): string { return typeof a + r.length + pad(0); }
function yieldsNothing(...r: unknown[]): void { pad(0); kept.length = r.length ? 0 : kept.length; }
function yieldsDouble(...r: number[]): number { return pad(0) + (r.length ? r[0] / 4 : -0); }
function yieldsReference(...r: unknown[]): Point { pad(0); return new Point(r.length, "made"); }
function throws(...r: unknown[]): number { pad(0); if (r.length > 1) throw new RangeError("got " + r.length); return r.length; }
function recursive(n: number, ...r: number[]): number { pad(0); return n ? recursive(n - 1, n, ...r) : r.length * 100 + (r[0] ?? -1); }
function captures(k: number): (...r: unknown[]) => number { return (...r: unknown[]): number => k + r.length + pad(0); }
class Emitter { count = 0; emit(type: string, ...r: unknown[]): boolean { pad(0); this.count += r.length; return type === "x"; } static of(...r: unknown[]): number { return r.length + pad(0); } }
async function later(...r: unknown[]): Promise<number> { pad(0); await null; return r.length; }
function* steps(...r: unknown[]): Generator<unknown> { pad(0); yield r.length; yield* r; }
const p = new Point(3, "p");
for (let round = 0; round < 3; round++) {
  console.log(lengthOnly(), lengthOnly(1), lengthOnly(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), reads(1), reads(1, "a"), reads(1, "a", 2.5), reads(1, undefined, null, p, true, -0), loops(), loops(1), loops(1, 2.5, -3), loops(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  const e1 = escapes(1, 2), e2 = escapes(1, 2), e3 = escapes();
  console.log(e1 !== e2, Array.isArray(e1), e1.length, e3.length, kept[kept.length - 3] === e1, JSON.stringify(e1), mutates(1, 2), mutates(), forwards(), forwards("a", "b", "c"), iterates(), iterates("x", "y"));
  console.log(ofInteger(7), ofInteger(7, 1), ofInteger(2147483647, 1, 2), ofDouble(1.5, 2), ofDouble(0.1, 3, "r"), ofBoolean(true), ofBoolean(false, 1), ofString("s"), ofString("", 1, 2), ofReference(p), ofReference(new Point(1, "q"), p), ofOptional(), ofOptional(undefined, 1), ofOptional(4, 1), ofUnion("s", 1), ofUnion(Symbol.iterator));
  console.log(yieldsNothing(), yieldsNothing(1), Object.is(yieldsDouble(), -0), yieldsDouble(1), yieldsDouble(NaN), yieldsReference(1, 2).x, yieldsReference().name, recursive(0), recursive(5), recursive(3, 9), captures(10)(), captures(10)(1, 2), Emitter.of(), Emitter.of(1, 2, 3));
  const em = new Emitter(); console.log(em.emit("x"), em.emit("y", 1), em.emit("x", 1, 2, 3), em.count);
  for (const n of [0, 1, 2, 3]) { try { console.log("throws", throws(...[1, 2, 3].slice(0, n)), n < 2 ? throws() : throws(1, 2)); } catch (e: any) { console.log("caught", e.constructor.name, e.message); } }
  try { console.log(throws(1, 2, 3)); } catch (e: any) { console.log("caught", e.message, lengthOnly(1, 2)); } finally { console.log("finally", lengthOnly(1)); }
  console.log([...steps(1, "b")].join(), [...steps()].join());
}
// Predicted, not known: the callee comes out of a variable, a field, an array; the prediction fails for the last.
const table: { f: (...r: unknown[]) => unknown }[] = [{ f: lengthOnly }, { f: lengthOnly }, { f: escapes }, { f: (...r: unknown[]) => "other" + r.length }];
for (const t of table) console.log(String(t.f()), String(t.f(1)), String(t.f(1, 2, 3)));
let variable: (a: number, ...r: unknown[]) => string = reads; console.log(variable(1, "v"), variable(2)); variable = (a: number, ...r: unknown[]) => "replaced" + a + r.length; console.log(variable(1, "v"), variable(2));
const anyEmitter: any = new Emitter(); console.log(anyEmitter.emit("x", 1), anyEmitter.emit("z"), anyEmitter.count, anyEmitter.emit.call(new Emitter(), "x", 1, 2), Reflect.apply(anyEmitter.emit, new Emitter(), ["x"]));
later(1, 2).then((n: number) => console.log("later", n));
export {};
