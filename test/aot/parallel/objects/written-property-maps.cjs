// Object.defineProperties with a map and descriptors that are written out.
const say = (...a) => console.log(a.join(" "));
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const describe = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + "=" + Object.keys(d).map(n => n[0] + ":" + (typeof d[n] === "function" ? "f " + d[n].name + d[n].length : typeof d[n] === "object" && d[n] ? JSON.stringify(d[n]) : String(d[n]))).join(","); }).join(" ; ");
class Text {
  constructor(s, options = {}) {
    const chunk = { start: 0, end: s.length }, bits = [1, 2];
    Object.defineProperties(this, {
      original: { writable: true, value: s }, outro: { writable: true, value: "" }, first: { writable: true, value: chunk }, last: { writable: true, value: chunk }, byStart: { writable: true, value: {} }, filename: { writable: true, value: options.filename },
      exclusion: { writable: true, value: options.ranges }, bits: { writable: true, value: bits }, indent: { writable: true, value: undefined }, offset: { writable: true, value: options.offset || 0 }, list: { writable: true, value: options.list ?? null },
    });
    if (options.seen) options.seen.push(this);
  }
  clone() { const t = new Text(this.original, { filename: this.filename, offset: this.offset + 1 }); t.outro = this.outro + "!"; t.last = t.first; return t; }
}
const t = new Text("abc", { filename: "f", offset: 2, list: [1] }); say(describe(t)); say(describe(t.clone().clone())); say(t.first === t.last, t.byStart === new Text("").byStart, Object.keys(t).length, JSON.stringify(t));
function all(o, n) {
  return Object.defineProperties(o, {
    plain: { value: n }, every: { value: n + 1, writable: true, enumerable: true, configurable: true }, none: {}, off: { writable: false, value: n * 2, enumerable: !1, configurable: !!0 }, w: { writable: true }, e: { enumerable: true }, c: { configurable: !0 },
    got: { get() { return this === o || n; } }, both: { get: () => n, set: v => { n = v; }, enumerable: true }, put: { set(v) { n = v; } }, method: { value() { return super.toString === Object.prototype.toString; } }, f: { value: function () { return n; } }, arrow: { value: () => n }, cl: { value: class { static x = n; } }, gen: { value: function* () {} }, named: { value: function own() {} }, as: { value: async () => {} }, list: { value: [n] }, un: { value: undefined }, nul: { value: null }, neg: { value: -0 }, t: { value: `t${n}` },
  });
}
for (const o of [{}, [1], function () {}, new (class K {})(), Object.create(null), new Map(), /x/g, new Uint8Array(2), new Proxy({}, {}), Object.create({ plain: 5 })]) { const r = all(o, 3); say(r === o, describe(o).slice(0, 900)); say(r.got, r.both, (r.both = 9, r.both), r.f(), r.arrow(), r.method(), r.cl.x, Object.is(r.neg, -0)); }
const again = all({}, 1); say(attempt(() => all(again, 1)), "/", attempt(() => all(again, 2)), "/", again.every);
// What is refused in the middle: what stands before it is defined, what stands behind it is not.
const ab = o => Object.defineProperties(o, { a: { value: 1 }, b: { value: 2 }, c: { value: 3 } });
for (const [n, o] of Object.entries({ frozen: Object.freeze({}), sealed: Object.seal({ a: 0 }), closed: Object.preventExtensions({ b: 1 }), fixed: Object.defineProperty({}, "b", { value: 7 }), same: Object.defineProperty({}, "b", { value: 2 }), bytes: new Uint8Array(1), args: (function () { return arguments; })(1) })) say(n, attempt(() => ab(o) === o), describe(o));
for (const v of [1, "s", null, undefined, Symbol.iterator, true, 5n]) say(typeof v, attempt(() => ab(v)));
const log = []; const spy = new Proxy({ own: 1 }, { defineProperty(x, k, d) { log.push(k + JSON.stringify(d)); return k === "c" ? false : Reflect.defineProperty(x, k, d); }, get(x, k) { log.push("get " + String(k)); return x[k]; }, isExtensible() { log.push("ext"); return true; } });
say(attempt(() => ab(spy)), log.join("|"));
// The order of evaluation.
const order = []; const n = (k, v) => { order.push(k); return v; };
let target = {}; const first = target; const made = Object.defineProperties((n("target"), target), { a: { value: n("a", target = { other: 1 }) }, b: { enumerable: true, value: n("b", 2), writable: false }, c: { get: function () { return n("got", 3); } } }); say(order.join(), made === first, describe(first), describe(target), made.c);
say(attempt(() => Object.defineProperties(first, { x: { value: 1 }, y: { value: (() => { throw new RangeError("y"); })() }, z: { value: 2 } })), describe(first));
let moved = { m: 1 }; say(attempt(() => Object.defineProperties(moved, { a: { value: Object.isFrozen(moved) }, b: { value: (Object.freeze(moved), 2) } })), describe(moved));
// Forms that stay calls.
const key = "computed", some = { value: 4 }, bad = { value: 1, get() {} };
say(describe(Object.defineProperties({}, { [key]: { value: 1 }, a: { value: 2 } })), describe(Object.defineProperties({}, { a: some, b: { ...some } })), describe(Object.defineProperties({}, { 2: { value: 1 }, 1: { value: 2 }, "x-y": { value: 3 }, z: { value: 4 } })));
say(attempt(() => describe(Object.defineProperties({}, { a: { value: 1 }, b: { get: 5 } }))), attempt(() => describe(Object.defineProperties({}, { a: { value: 1 }, b: { value: 1, get() {} } }))), attempt(() => describe(Object.defineProperties({}, { a: { value: 1 }, b: bad }))), attempt(() => describe(Object.defineProperties({}, { a: { get: undefined, set: undefined }, b: { get: undefined } }))));
const half = {}; say(attempt(() => Object.defineProperties(half, { a: { value: 1 }, b: { get: 5 } })), describe(half), attempt(() => Object.defineProperties(half, { a: { value: 1 }, b: 7 })), describe(half), attempt(() => Object.defineProperties(half, { a: { value: 1 }, get b() { throw new Error("read"); } })), describe(half));
say(describe(Object.defineProperties({}, { a: { value: 1 }, a: { value: 2, enumerable: true } })), describe(Object.defineProperties({}, {})), describe(Object.defineProperties({}, { a: { writable: n, value: 3 }, b: { enumerable: 0, value: 1 }, c: { configurable: "yes" }, d: { enumerable: null }, e: { writable: undefined } })));
say(describe(Object.defineProperties({}, { __proto__: { p: { value: 1 } }, a: { value: 2 } })), describe(Object.defineProperties({}, { ["__proto__"]: { value: 1 } })), describe(Object.defineProperties({}, { constructor: { value: 1 }, toString: { value: 2 }, hasOwnProperty: { get: () => 3 } })));
say(attempt(() => Object.defineProperties()), attempt(() => Object.defineProperties({})), attempt(() => Object.defineProperties(...[{ s: 1 }, { a: { value: 1 } }]).a), attempt(() => Object.defineProperties({}, { a: { value: 1 } }, n("third")).a), Object?.defineProperties({}, { a: { value: 1 } }).a);
// Prototypes, classes, generators, async functions, derived constructors.
function Shape() {} Object.defineProperties(Shape.prototype, { area: { get() { return this.w * this.h; }, configurable: true }, scale: { value(k) { this.w *= k; return this; }, writable: true }, kind: { value: "shape" } }); const sh = new Shape(); sh.w = 2; sh.h = 3; say(sh.area, sh.scale(2).area, sh.kind, describe(Shape.prototype));
class Base { constructor() { Object.defineProperties(this, { id: { value: ++Base.n } }); } static n = 0; static { Object.defineProperties(this, { made: { get() { return this.n; } } }); } } class Derived extends Base { constructor(early) { if (early) Object.defineProperties(this, { x: { value: 1 } }); super(); Object.defineProperties(this, { tag: { value: "d" + this.id, writable: true } }); } } say(new Derived().tag, new Derived().tag, Base.made, attempt(() => new Derived(true)), describe(new Derived()));
function* steps(o) { yield Object.defineProperties(o, { a: { value: yield "first" }, b: { value: yield "second", enumerable: true } }); } const g = steps({}); say(g.next().value, g.next(1).value, describe(g.next(2).value));
(async () => { say(describe(Object.defineProperties({}, { a: { value: await 1 }, b: { get: (await 2, () => 3) }, c: { value: await Promise.resolve(4) } }))); })();
function inLoop(count) { let sum = 0; for (let i = 0; i < count; i++) { const o = Object.defineProperties({ i }, { twice: { value: i * 2 }, half: { get() { return this.i / 2; } } }); sum += o.twice + o.half; } return sum; } say(inLoop(10), inLoop(1000));
const early = () => { try { Object.defineProperties({}, { a: { value: late } }); } catch (e) { return e.constructor.name; } let late; }; say(early());
try { Object.defineProperties(Object.freeze({}), { deep: { value: 1 } }); } catch (e) { say(e.stack.split("\n").length > 1, e.message); }
