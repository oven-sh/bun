// Pushes of any value onto lists of every kind, with reads of the length, the elements and the kind of storage right behind them: int32s, doubles, values, holes, frozen and extended lists, subclasses, replaced methods.
const out = [], show = x => Array.isArray(x) ? "[" + x.length + ":" + Array.prototype.slice.call(x, 0, 9).map(show) + "]" : Object.is(x, -0) ? "-0" : String(x);
const attempt = f => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
class Stack {
  constructor(items) { this.items = items; this.limit = 50; this.deepest = 0; }
  push(v) { if (this.items.length >= this.limit) throw new RangeError("full"); this.items.push(v); if (this.items.length > this.deepest) this.deepest = this.items.length; }
  pop() { if (!this.items.length) throw new RangeError("empty"); return this.items.pop(); }
}
class Heap {
  constructor(items) { this.a = items; }
  push(v) { const a = this.a; let i = a.length; a.push(v); while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= a[i]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; } }
}
class Sub extends Array { push(...v) { return super.push(...v) + 100; } }
const lists = [() => [], () => [5, 3], () => [0.5, 2], () => ["b", "a"], () => [, 1], () => new Array(3), () => Object.freeze([1]), () => Object.preventExtensions([2]), () => new Sub(), () => { const l = [1]; l.push = v => { l[l.length] = v; return "own"; }; return l; }, () => { const l = [1]; l.length = 48; return l; }];
const values = [k => k, k => k + 0.5, k => -0, k => NaN, k => "s" + k, k => undefined, k => null, k => k & 1 ? k : 0.25, k => k > 3 ? "t" : k, k => 2147483646 + k, k => [k]];
for (const list of lists) for (const value of values) {
  attempt(() => { const s = new Stack(list()); let n = 0; for (let k = 0; k < 7; k++) { s.push(value(k)); if (k % 3 === 2) n += String(s.pop()).length; } return [n, s.deepest, s.items]; });
  attempt(() => { const h = new Heap(list()); for (let k = 0; k < 7; k++) h.push(value((k * 5) % 7)); return h.a; });
}
console.log(out.join("\n"));
