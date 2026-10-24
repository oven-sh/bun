// A helper that throws half way, caught in the constructor.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class A { constructor() { try { this.init(); } catch {} } init() { this.ua = { qb: 1 }; mayThrow(); this.ub = { qb: 2 }; } }
const a = new A();
console.log(attempt(() => a.ua.qb), attempt(() => a.ub.qb), Object.keys(a).join());
class B { constructor() { try { fill(this); } catch {} finally { seen.push(attempt(() => this.vb.qb)); } } }
function fill(o) { o.va = { qb: 1 }; mayThrow(); o.vb = { qb: 2 }; }
const b = new B();
console.log(seen.join(), attempt(() => b.vb.qb), Object.keys(b).join());
class C { wa = { qb: 1 }; wb = (mayThrow(), { qb: 2 }); wc = { qb: 3 }; }
let kept; class D extends C { } class E { xa = (kept = this, { qb: 1 }); xb = (mayThrow(), { qb: 2 }); xc = { qb: 3 }; }
attempt(() => new E());
console.log(attempt(() => kept.xa.qb), attempt(() => kept.xb.qb), attempt(() => kept.xc.qb), Object.keys(kept).join());
function K() { try { this.ya = { qb: 1 }; mayThrow(); this.yb = { qb: 2 }; } catch {} }
const k = new K();
console.log(attempt(() => k.yb.qb), Object.keys(k).join());
