// Everything that could distinguish a returned object whose allocation was removed from a real object.
declare const console: { log(...v: unknown[]): void };
const out: string[] = []; const say = (...v: unknown[]): void => { out.push(v.map(String).join(",")); };
function spin(x: number): number { return x < 2 ? x + 1 : spin(x - 1) + spin(x - 2) * 0.5; }
// new.target, `new`, this
function target(this: unknown, x: number): { isNew: boolean, x: number } { if (x < 0) return { isNew: false, x: 0 }; return { isNew: new.target !== undefined, x: spin(x & 3) }; }
{ const { isNew, x } = target(2); say("plain", isNew, x); const made = new (target as any)(2); say("new", made.isNew, made.x, made instanceof (target as any), Object.getPrototypeOf(made) === Object.prototype); }
function usesThis(this: { k: number }, x: number): [number, number] { if (x < 0) return [0, 0]; return [this.k, this.k + spin(x & 3)]; }
{ const [a, b] = usesThis.call({ k: 5 }, 2); say("call", a, b); const [c, d] = usesThis.apply({ k: 6 }, [1]); say("apply", c, d); const bound = usesThis.bind({ k: 7 }); const [e, f] = bound(3); say("bind", e, f, bound.name, bound.length); }
// arguments, rest, defaults, fewer and more arguments than parameters
function counts(a: number, b?: number): { n: number, b: number } { if (a < 0) return { n: -1, b: 0 }; return { n: arguments.length, b: b === undefined ? -1 : b }; }
{ const { n, b } = counts(1); say("arguments", n, b); const r = (counts as any)(1, 2, 3); say(r.n, r.b); }
function rest(a: number, ...more: number[]): [number, number] { if (a < 0) return [0, 0]; return [a, more.length]; }
{ const [a, n] = rest(1, 2, 3, 4); say("rest", a, n); }
function defaults(a: number, b: number = a * 2): [number, number] { if (a < 0) return [b, a]; return [a, b + spin(a & 3)]; }
{ const [a, b] = defaults(3); say("default", a, b); const [c, d] = defaults(3, 1); say(c, d); const [e, f] = defaults(-3); say(e, f); const [g, h] = (defaults as any)(2, undefined, 9); say(g, h); }
// async, generators, async generators: an object is what they resolve with or yield
async function later(x: number): Promise<{ a: number, b: number }> { if (x < 0) return { a: 0, b: 0 }; return { a: x, b: spin(x & 3) }; }
function* each(x: number): Generator<[number, number], { last: number, n: number }> { yield [x, x + 1]; yield [x + 2, x + 3]; return { last: x, n: 2 }; }
{ const g = each(1); const first = g.next(); const [p, q] = first.value as [number, number]; say("generator", p, q, first.done); g.next(); const end = g.next(); say((end.value as any).last, end.done); for (const [a, b] of each(5)) say(a, b); }
// recursion: through itself, and two through each other
function walk(n: number): { depth: number, sum: number } { if (n <= 0) return { depth: 0, sum: 0 }; const { depth, sum } = walk(n - 1); return { depth: depth + 1, sum: sum + n }; }
{ const { depth, sum } = walk(20); say("recursion", depth, sum); const w = walk(3); say(JSON.stringify(w)); }
function ping(n: number): [number, string] { if (n <= 0) return [0, "."]; const [k, s] = pong(n - 1); return [k + 1, s + "i"]; }
function pong(n: number): [number, string] { if (n <= 0) return [0, "!"]; const [k, s] = ping(n - 1); return [k + 2, s + "o"]; }
{ const [k, s] = ping(7); say(k, s); say(pong(4).join("/")); }
// closures, methods, statics, accessors
function maker(base: number): (x: number) => { lo: number, hi: number } { return x => { if (x < 0) return { lo: base, hi: base }; return { lo: base - spin(x & 3), hi: base + x }; }; }
{ const f = maker(10), g = maker(20); const { lo, hi } = f(2); say("closure", lo, hi); const r = g(-1); say(r.lo, r.hi, f(1) === f(1)); }
class Box { constructor(public w: number, public h: number) {}
  size(scale: number): { w: number, h: number } { if (scale === 0) return { w: 0, h: 0 }; return { w: this.w * scale, h: this.h * scale + spin(scale & 3) }; }
  static unit(k: number): [number, number] { if (k < 0) return [-1, -1]; return [k, spin(k & 3)]; }
  get corner(): { x: number, y: number } { if (this.w < 0) return { x: 0, y: 0 }; return { x: this.w, y: this.h }; } }
class Tall extends Box { size(scale: number): { w: number, h: number } { const { w, h } = super.size(scale); if (h < 0) return { w: h, h: w }; return { w, h: h * 2 }; } }
{ const boxes: Box[] = [new Box(1, 2), new Tall(3, 4)]; for (const b of boxes) { const { w, h } = b.size(2); say("method", w, h); const { x, y } = b.corner; say(x, y); } const [a, c] = Box.unit(3); say(a, c); const m = boxes[0].size; say(JSON.stringify(m.call(boxes[1], 1))); }
// what the object is, where it is observed
function pt(x: number): { x: number, y: number } { if (x < 0) return { x: 0, y: 0 }; return { x, y: spin(x & 3) }; } //! removed; heap
say("object", typeof pt(1), String(pt(1)), pt(1) == pt(1), pt(1) instanceof Object, "x" in pt(1), "z" in pt(1), Object.keys(pt(2)).join(), JSON.stringify({ ...pt(2), z: 1 }), pt(3)?.y, Object.isFrozen(Object.freeze(pt(1))));
{ const p = pt(2); p.x = 9; say(JSON.stringify(p)); const q = pt(2); const alias = q; alias.x = 7; say(q.x); let seen = 0; for (const k in pt(1)) seen += k.length; say(seen); }
// results that are objects, closures, strings, null or undefined, big numbers, -0, NaN
function mixed(x: number): { inner: { v: number }, f: () => number, s: string, u: undefined, n: null, z: number, nan: number, big: number } {
  if (x < 0) return { inner: { v: -1 }, f: () => -1, s: "", u: undefined, n: null, z: 0, nan: 0, big: 0 };
  return { inner: { v: x }, f: () => x * 2, s: "s" + x, u: undefined, n: null, z: -0, nan: NaN, big: 2 ** 53 + spin(x & 1) };
}
{ const { inner, f, s, u, n, z, nan, big } = mixed(4); say("mixed", inner.v, f(), s, u, n, Object.is(z, -0), nan, big); }
function five(x: number): [number, number, number, number, number] { if (x < 0) return [0, 0, 0, 0, 0]; return [x, x + 1, x + 2, x + 3, spin(x & 3)]; }
{ const [a, b, c, d, e] = five(1); say("five", a, b, c, d, e); }
// literals that are not plain: twice the same key, a computed key, __proto__, a spread
function twice(x: number): { a: number } { if (x < 0) return { a: 0 }; const more: { a?: number } = { a: x }; return { a: 1, ...more }; }
function computed(x: number, k: string): Record<string, number> { if (x < 0) return { [k]: 0 }; return { [k]: x }; }
function proto(x: number): { a: number } { if (x < 0) return { a: 0 }; return { a: x, __proto__: { b: 5 } } as any; }
say("literals", twice(3).a, computed(3, "q").q, proto(3).a, (proto(3) as any).b);
later(3).then(({ a, b }) => { say("async", a, b); console.log(out.join(" | ")); });
