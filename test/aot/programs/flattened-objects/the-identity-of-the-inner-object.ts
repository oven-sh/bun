// Whatever can tell one object from another is tried on an inner object that was born in a literal inside a literal, or by `new` in a constructor.
interface Inner { b: number; s: string }
interface Outer { a: Inner; n: number }
function make(i: number): Outer { return { a: { b: i, s: "s" + i }, n: i }; }
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));

{ const x = make(1); say("same", x.a === x.a, x.a == x.a, Object.is(x.a, x.a), x.a !== make(1).a); }
{ let x: Outer | null = make(2); const alias = x.a; x = null; Bun.gc(true); alias.b += 1; say("outlives", alias.b, alias.s); }
{ const x = make(3), y = make(4); x.a = y.a; x.a.b = 40; say("carried", y.a.b, x.a === y.a, x.n, y.n); y.a = { b: 5, s: "new" }; say("carried", x.a.b, y.a.b, x.a === y.a); }
{ const x = make(5); const before = x.a; delete (x as any).a; say("deleted", "a" in x, x.a === undefined, before.b, Object.keys(x).join()); (x as any).a = before; say("put back", x.a === before, Object.keys(x).join()); }
{ const x = make(6); say("keys", Object.keys(x).join(), Object.keys(x.a).join(), JSON.stringify(x), JSON.stringify(x.a)); }
{ const x = make(7); const clone = structuredClone(x); clone.a.b = 70; say("clone", x.a.b, clone.a.b, clone.a === x.a); const inner = structuredClone(x.a); inner.b = 71; say("clone", x.a.b, inner.b); }
{ const x = make(8); const outer = { ...x }; const inner = { ...x.a }; outer.a.b = 80; inner.b = 81; say("spread", x.a.b, outer.a === x.a, inner.b, inner === (x.a as unknown)); }
{ const x = make(9); Object.freeze(x); x.a.b = 90; say("frozen outer", x.a.b, Object.isFrozen(x), Object.isFrozen(x.a)); let threw = false; try { "use strict"; (x as any).a = null; } catch { threw = true; } say("frozen outer", threw, x.a.b); }
{ const x = make(10); Object.freeze(x.a); let threw = false; try { x.a.b = 100; } catch { threw = true; } say("frozen inner", threw, x.a.b, Object.isFrozen(x.a), Object.isFrozen(x)); x.n = 11; say("frozen inner", x.n); }
{ const x = make(11); Object.setPrototypeOf(x, { get a() { return "from the prototype"; } }); say("getter above", x.a.b, Object.keys(x).join()); delete (x as any).a; say("getter above", (x as any).a, Object.keys(x).join()); }
{ const x = make(12); const seen: string[] = []; const proxy = new Proxy(x, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } }); proxy.a.b += 1; say("proxy", x.a.b, seen.join(), proxy.a === x.a); const inner = new Proxy(x.a, {}); inner.b += 1; say("proxy", x.a.b); }
{ const x = make(13), y = make(14); const shared = x.a; y.a = shared; const third: Outer = { a: shared, n: 0 }; third.a.b = 130; say("two parents", x.a.b, y.a.b, third.a === x.a); }
{ const x = make(15); const map = new WeakMap<object, string>(); map.set(x.a, "inner"); map.set(x, "outer"); const ref = new WeakRef(x.a); const set = new Set<object>([x.a]); Bun.gc(true); say("weak", map.get(x.a), map.get(x), ref.deref() === x.a, set.has(x.a), set.has(x)); }
{ const x = make(16); function who(this: Inner) { this.b += 1; return this; } say("this", who.call(x.a) === x.a, x.a.b, who.apply(x.a).b, who.bind(x.a)().b); }
{ const x = make(17); (x.a as any).extra = "added"; say("added", (x.a as any).extra, Object.keys(x.a).join(), Object.keys(x).join()); delete (x.a as any).s; say("removed", Object.keys(x.a).join(), x.a.s); }
{ const x = make(18); (x.a as any).b = "a string"; say("other type", x.a.b, typeof x.a.b); (x as any).a = 7; say("other type", x.a, typeof x.a); (x as any).a = undefined; say("other type", x.a); }
{ const x = make(19); const c = x.a; x.a = { b: 190, s: "next" }; say("alias across a store", c.b, c.s, x.a.b, c === x.a); c.b = 191; say("alias across a store", c.b, x.a.b); }
{ const x = make(20); const replace = (o: Outer) => { o.a = { b: 200, s: "from a call" }; }; const c = x.a; replace(x); say("alias across a call", c.b, x.a.b); }
{ const x = make(21); const { a } = x; const { b, s } = x.a; a.b = 210; say("destructured", b, s, x.a.b, a === x.a); }
{ const x = make(22); say("typeof", typeof x.a, x.a instanceof Object, Object.getPrototypeOf(x.a) === Object.prototype, x.a.constructor === Object, String(x.a), x.a ? "truthy" : "falsy", x.a == null, x.a ?? "nullish"); }
{ const x = make(23); Object.setPrototypeOf(x.a, { inherited: "yes" }); say("prototype", (x.a as any).inherited, x.a.b, Object.getPrototypeOf(x) === Object.prototype); }
{ const x = make(24); const entries = Object.entries(x); say("entries", entries.length, entries[0][0], entries[0][1] === x.a, Object.values(x)[0] === x.a, Object.getOwnPropertyDescriptor(x, "a")!.value === x.a, Reflect.ownKeys(x).join(), Object.getOwnPropertyNames(x).join(), Object.getOwnPropertySymbols(x).length); }
{ const x = make(25); const target = Object.assign({}, x); const into = Object.assign(make(26), x); say("assign", target.a === x.a, into.a === x.a, into.n); }
{ const many: Outer[] = []; for (let i = 0; i < 2000; i++) many.push(make(i)); const kept = many.filter((_, i) => i % 500 === 0).map(o => o.a); Bun.gc(true); let sum = 0; for (const o of many) sum += o.a.b; kept[1].b = -1; say("many", sum, many[500].a.b, kept.length, kept[3] === many[1500].a); }

class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } length() { return Math.hypot(this.x, this.y); } }
class Segment { from: Point; to: Point; constructor(i: number) { this.from = new Point(i, i); this.to = new Point(i + 3, i + 4); } }
{ const s = new Segment(0); say("class", s.to.length(), s.from === s.from, s.from !== s.to, s.to instanceof Point, s.to.constructor === Point, JSON.stringify(s), Object.keys(s).join()); const to = s.to; s.to = s.from; to.x = 9; say("class", s.to.x, to.x, s.to === s.from); }
console.log(lines.join("\n"));
