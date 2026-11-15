// Arrays of indices held as int32s, as doubles and as other values, read in loops, inner loops and short loops; the elements may be fractions, negative, past the end, holes, strings, or change on the way.
"use strict";
var log = [], n = 18;
function make(f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function changed(a, at, v) { var b = a.slice(); b[at] = v; return b; }
function inDoubles(a) { var b = a.slice(); b[0] += .5; for (var i = 1; i < b.length; i++) b[i] += .5; for (var i = 0; i < b.length; i++) b[i] -= .5; return b; }
function dump(t) { var s = t.length + ":"; for (var i = 0; i < 20; i++) s += (i in t ? (Object.is(t[i], -0) ? "-0" : String(t[i])) : "") + ","; return s; }
class Graph {
  constructor(head, next, value, weight, rows) { this.n = n; this.head = head; this.next = next; this.value = value; this.weight = weight; this.rows = rows; }
  sum() { let s = 0; for (let i = 0; i < this.n; i++) s += this.value[this.head[i]]; return s; }
  chain() { let s = 0; for (let i = 0; i < this.n; i++) s = s + this.value[this.next[this.head[i]]] | 0; return s; }
  dot() { let s = 0; for (let i = 0; i < this.n; i++) s += this.weight[i] * this.value[this.next[i]]; return s; }
  relax() { let c = 0; for (let i = 0; i < this.n; i++) { const a = this.head[i], b = this.next[i]; if (this.value[a] + this.weight[i] < this.value[b]) c++; } return c; }
  follow() { let x = 0, s = ""; for (let i = 0; i < this.n; i++) { x = this.next[x]; s += x; } return s; }
  inner() { let s = 0; for (let k = 0; k < 3; k++) { const row = this.rows[k], at = this.head; for (let i = 0; i < this.n; i++) s += row[at[i]] * (k + 1); } return s; }
  innermost() { let x = 1; for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < this.n; i++) x = x << 1 ^ this.rows[k][this.next[i] + j] ^ x >>> 31; return x; }
  boxes(x) { const f = this.head, g = this.value; for (let i = 0; i < 12; i++) x = g[f[x & 15]] ^ i; return x; }
  fold() { let x = 0; const f = this.head; for (let i = 0; i < 8; i++) x ^= f[(x ^ i) & 15]; return x; }
  steps() { let x = 0; const f = this.head; for (let i = 0; i < 8; i++) x ^= f[i + 1]; return x; }
  stores() { const t = this.value.slice ? this.value.slice() : []; for (let i = 0; i < this.n; i++) t[this.head[i]] = this.value[this.next[i]]; return dump(t); }
  counts() { const t = make(i => 0); for (let i = 0; i < this.n; i++) t[this.next[i]]++; return dump(t); }
  grows(v) { let s = 0; const h = this.head.slice ? this.head.slice() : this.head; for (let i = 0; i < this.n; i++) { s += this.value[h[i]]; if (i === 5) h[9] = v; } return s; }
  leaves() { let s = 0; for (let i = 0; i < this.n; i++) { const at = this.head[i]; if (at > 14) break; if (at < 0) throw new RangeError(at); s += this.value[at]; } return s; }
  some() { let s = 0; for (let i = 0; i < this.n; i++) if (i & 3) s += this.value[i]; else s -= this.value[this.next[i]]; return s; }
}
var keys = make(function (i) { return i * 5 % 18; }), ints = make(function (i) { return Math.imul(i + 3, 0x9e3779b9) >> 2; }), doubles = make(function (i) { return i * 1.25 - 3; });
var heads = {
  ints: keys, doubles: inDoubles(keys), fraction: changed(inDoubles(keys), 3, 2.5), negative: changed(inDoubles(keys), 3, -1), minusZero: changed(inDoubles(keys), 0, -0), past: changed(inDoubles(keys), 3, 99), large: changed(inDoubles(keys), 3, 2147483648), least: changed(inDoubles(keys), 3, -2147483648), larger: changed(inDoubles(keys), 3, 4294967295),
  wraps: changed(inDoubles(keys), 3, 4294967298), huge: changed(inDoubles(keys), 3, 1e300), odd: changed(inDoubles(keys), 3, 9007199254740993), nan: changed(inDoubles(keys), 3, NaN), hole: (function () { var b = inDoubles(keys); delete b[4]; return b; })(), holeOfInts: (function () { var b = keys.slice(); delete b[4]; return b; })(),
  string: changed(keys, 3, "7"), boxed: changed(changed(inDoubles(keys), 3, "7"), 3, 7), word: changed(keys, 3, "length"), nothing: changed(keys, 3, undefined), object: changed(keys, 3, { toString: function () { log.push("asked"); return "6"; } }),
  frozen: Object.freeze(inDoubles(keys)), floats: new Float64Array(changed(keys, 3, 2.5)), words: new Uint32Array(keys), short: [1.5, 2.5], below: (class extends Array {}).from(inDoubles(keys)), getter: Object.defineProperty(inDoubles(keys), 5, { get: function () { log.push("got"); return 2; } }), proxy: new Proxy(keys.slice(), { get: function (t, k) { if (k === "2") log.push("trap"); return t[k]; } })
};
var values = { ints: ints, doubles: doubles, holes: (function () { var a = ints.slice(); delete a[5]; return a; })(), words: make(function (i) { return "w" + i; }), keyed: changed(ints, 2.5, 77), above: Object.create({ 99: 5, "-1": 4 }) };
function show(f) { try { var v = f(); return Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (error) { return "threw " + error.name; } }
for (var p in heads) for (var t in values) {
  var g = new Graph(heads[p], heads.doubles, values[t], doubles, [values[t], ints, doubles]), h = new Graph(keys, heads[p], values[t], doubles, [doubles, values[t], keys]), own = new Graph(heads[p], heads[p], heads[p], heads[p], [heads[p], heads[p], heads[p]]);
  console.log(p, t, [g, h, own].map(function (g) {
    return [show(function () { return g.sum(); }), show(function () { return g.chain(); }), show(function () { return g.dot(); }), show(function () { return g.relax(); }), show(function () { return g.follow(); }), show(function () { return g.inner(); }), show(function () { return g.innermost(); }), show(function () { return g.boxes(7); }), show(function () { return g.fold(); }),
      show(function () { return g.steps(); }), show(function () { return g.stores(); }), show(function () { return g.counts(); }), show(function () { return g.grows(p === "ints" ? 1.5 : 3); }), show(function () { return g.leaves(); }), show(function () { return g.some(); })].join(" | ");
  }).join(" || "), log.splice(0).join());
}
