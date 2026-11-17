// What a function makes, fills and returns is one object under all its names.
const kept = [], lines = []; let calls = 0;
const next = value => { calls++; return value; };
const show = (...values) => lines.push(values.map(value => value && typeof value === "object" ? Object.entries(value).map(([key, held]) => key + "=" + (held === value ? "self" : Object.is(held, -0) ? "-0" : String(held))).join(",") : String(value)).join(" | "));
function row(x) { const made = {}; made.first = next(x); made.second = null; made.third = -0; return made; }
function half(x) { const made = { a: 1 }; if (x) made.b = x; else made.c = next(0); made.d = NaN; return made; }
function looped(n) { const made = { sum: 0, last: null }; for (let i = 0; i < n; i++) { made.sum += i; made.last = i % 2 ? "odd" : i; } made.done = true; return made; }
function seen(x) { const made = {}; made.a = x; kept.push(made); made.b = next(x); return made; }
function handed(made) { made.b = next(2); made.c = 3; return made; }
function self(x) { const made = {}; made.x = x; made.me = made; return made; }
function pair(x) { const inner = {}; inner.x = x; const outer = {}; outer.inner = inner; inner.outer = outer; return outer; }
function guarded(x) { const made = {}; try { made.a = x.y.z; } catch { made.a = "none"; } finally { made.b = next(1); } return made; }
function* steps(x) { const made = {}; made.a = x; yield made; made.b = next(x); return made; }
async function later(x) { const made = {}; made.a = x; await null; made.b = next(x); return made; }
const arrow = x => { const made = {}; made.x = x; made.get = () => made.x; return made; };
class Point { constructor(x) { this.x = x; } static of(x) { const made = new this(x); made.y = next(x); return made; } with(y) { const made = new Point(this.x); made.y = y; return made; } same(y) { this.y = y; return this; } }
function Old(x) { this.x = x; this.y = next(x); if (x > 1) this.z = this; } Old.make = x => { const made = new Old(x); made.w = 4; return made; };
function chosen(x) { const a = {}; a.x = 1; const b = {}; b.x = 2; const made = x ? a : b; made.y = x; return [made, made === a, made === b, a.y, b.y]; }
for (const x of [0, 1, 2.5, "t", undefined]) {
  show(row(x), half(x), seen(x), self(x).me === self(x), guarded(x), guarded({ y: { z: x } }));
  const own = { a: x }, result = handed(own); show(own === result, own, Object.keys(result).join());
  const point = Point.of(x), other = point.with(7), same = other.same(x); show(point, other, same === other, point instanceof Point);
  const old = Old.make(x); show(old.x, old.y, old.w, old.z === old, Object.keys(old).join()); show(...chosen(x));
  const outer = pair(x); show(outer.inner.outer === outer, outer.inner.x); const closed = arrow(x); closed.x = "set"; show(closed.get());
  const walked = steps(x), first = walked.next().value, second = walked.next().value; show(first === second, second);
}
for (const n of [0, 1, 5]) show(looped(n));
let total = 0; for (let i = 0; i < 200; i++) { const made = row(i); made.first += 1; made.second = made; if (made.second.first === i + 1) total += made.first; } show(total, calls, kept.length, kept[0] === seen, kept.every(made => "b" in made));
Promise.all([later(1), later("t")]).then(all => { show(...all); console.log(lines.join("\n")); });
