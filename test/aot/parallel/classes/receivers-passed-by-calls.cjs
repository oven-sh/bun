// Plain functions, and functions stored under a name, that methods of one class call with their own `this`; and the same functions on every other receiver.
const out = [];
const show = (v) => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (v === globalThis ? "global" : JSON.stringify(v)) : typeof v === "function" ? "fn" : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
class Meter { init(at) { this.sacks = [at, at + 1]; this.place = at; this.open = true; return this; } here() { return this.place * 2; } }
let mill = {};
{ class Mill { constructor(at) { this.meter = new Meter(); this.meter.init(at); this.wish = { fine: at > 2 }; this.count = 0; } turn() { this.meter.place++; return this.meter.place; } stands(v) { return this.meter.place === v; } get twice() { return this.count * 2; } } mill = Mill; }
let windmill = {};
{ const Parent = mill; class Windmill extends Parent { constructor(at) { super(at); this.sails = "abcdef"; } step(v) { return this.turn() + v; } } windmill = Windmill; windmill.tag = 1; }
const K = windmill;
{
  const P = K, arms = P.prototype;
  function grind(sack, sort, at) { this.count += 1; if (this.wish.fine) sack.flour = [0, at]; this.weigh(sack); sack.sort = sort + at; sack.at = at; return sack; }
  let other = function (sack, a) { const f = () => this.meter.here(); this.late = a; return f() + this.twice + this.step(a) + (this.stands(a) ? 100 : 0); };
  arms.weigh = function (sack) { sack.text = this.sails.slice(this.meter.place & 3); this.meter.open = false; };
  arms.grindOne = function (sack, sort) { return grind.call(this, sack, sort, this.meter.place); };
  arms.grindAt = function (sack, sort, at) { return grind.apply(this, [sack, sort, at]); };
  arms.other = function (sack, a) { return other.call(this, sack, a); };
  arms.swap = function () { other = function (sack, a) { return this === undefined ? "none" : a; }; };
  globalThis.grindOf = grind; globalThis.otherOf = (r, ...l) => other.apply(r, l);
}
class Wind { constructor(label) { this.label = label; this.change = null; } }
const winds = { a: new Wind("a"), b: new Wind("b"), c: new Wind("c"), d: new Wind("d") };
winds.a.change = function (before) { if (before === winds.b) this.meter.sacks.unshift(this.meter.place); this.meter.open = !before; return this.count; };
winds.b.change = winds.d.change = function () { const gone = this.meter.sacks.shift(); if (gone === 1) this.meter.open = true; return gone; };
K.prototype.blow = function (wind, before) { const change = wind.change; if (change) return change.call(this, before); return wind.label === before ? "same" : this.meter.open; };
const work = (p, m) => { let t = 0; for (let i = 0; i < m; i++) { const sack = { n: i }; const v = i % 3 === 0 ? p.grindOne(sack, "k" + (i & 1)) : i % 3 === 1 ? p.grindAt(sack, "at", i) : p.other(sack, i); const u = p.blow(winds["abcd"[i & 3]], winds["bcad"[i & 3]]); t = (t * 31 + (typeof v === "number" ? v : v ? Object.keys(v).length : 2) + (typeof u === "number" ? u : u ? 3 : 1)) | 0; } return t; };
const p = new K(1);
tell(() => work(p, 1)); tell(() => work(p, 9)); tell(() => work(new K(3), 60)); tell(() => p.meter); tell(() => p.grindOne({ n: 1 }, "x"));
tell(() => { let s = 0; for (let i = 0; i < 200; i++) s = (s + work(new K(i & 7), 6)) | 0; return s; });
const receivers = [undefined, null, 5, "s", true, 3n, { meter: { place: 1, sacks: [], here() { return 2; } }, wish: {}, count: 1, sails: "zz", turn() { return 4; }, step(v) { return v; }, stands() { return false; }, weigh(n) { n.weighed = 1; } }, Object.create(p), new Proxy(new K(2), {}), Object.freeze(new K(2)), K, K.prototype, new (class extends K { constructor() { super(4); this.extra = 1; } turn() { return 1000; } weigh(n) { n.heir = 1; } })(), [], function () {}, Object.assign(new K(5), { meter: "gone" }), Object.defineProperty(new K(6), "meter", { get() { return new Meter().init(8); } }), Object.setPrototypeOf(new K(7), { turn() { return 9; }, step() { return 3; }, stands() { return true; }, weigh() { } }), (() => { const q = new K(2); delete q.meter; return q; })(), (() => { const q = new K(2); q.next = () => 77; q.weigh = (n) => { n.own = 1; }; return q; })()];
for (const r of receivers) { tell(() => grindOf.call(r, { n: 1 }, "k", 2)); tell(() => otherOf(r, { n: 1 }, 2)); tell(() => winds.a.change.call(r, winds.b)); tell(() => winds.b.change.call(r)); tell(() => K.prototype.blow.call(r, winds.d, 0)); }
tell(() => grindOf({ n: 1 }, "k", 2)); tell(() => winds.a.change(winds.b)); tell(() => new grindOf({ n: 1 }, "k", 2) instanceof grindOf);
p.wish = null; tell(() => work(p, 5)); p.wish = { fine: 1 }; p.meter = { place: "text", sacks: new Set(), here() { return 1; } }; tell(() => work(p, 6));
K.prototype.weigh = function (n) { n.replaced = this.count; }; tell(() => work(new K(2), 12));
winds.a.change = function () { return this instanceof K ? 1 : 2; }; winds.c.change = () => 9; tell(() => work(new K(2), 12));
new K(1).swap(); tell(() => work(new K(2), 12)); tell(() => otherOf(undefined, 1, 2));
for (const line of out) console.log(line);
