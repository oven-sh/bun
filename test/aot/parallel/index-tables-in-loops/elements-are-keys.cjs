// Loops whose elements are keys of other arrays: tables of places hold int32s, doubles, fractions, negative numbers, holes, strings, symbols or objects, and change on the way.
"use strict";
class Places extends Array {}
var log = [];
function dump(t) { var s = t.length + ":"; for (var i = 0; i < 24; i++) s += (i in t ? String(t[i]) : "") + ","; return s; }
function sum(a, b, n) { var s = 0; for (var i = 0; i < n; i++) s += a[b[i]]; return s; }
function fold(a, b, n) { var x = 1; for (var i = 0; i < n; i++) x = x << 1 ^ a[b[i]] ^ x >>> 31; return x; }
function boxes(g, b, n, x) { for (var i = 0; i < n; i++) x = g[0][b[x >>> 28]] ^ g[1][b[x >> 16 & 15]] ^ g[2][b[x & 15]] ^ i; return x; }
function dot(v, a, b, n) { var s = 0; for (var i = 0; i < n; i++) s += v[i] * a[b[i]]; return s; }
function gather(a, b, t, n) { for (var i = 0; i < n; i++) t[i] = a[b[i]]; return dump(t); }
function scatter(a, b, t, n) { for (var i = 0; i < n; i++) t[b[i]] = a[i]; return dump(t); }
function count(b, t, n) { for (var i = 0; i < n; i++) t[b[i]] = t[b[i]] + 1; return dump(t); }
function changes(a, b, n, at, v) { var x = 0; for (var i = 0; i < n; i++) { x = x << 1 ^ a[b[i]]; if (i === 5) b[at] = v; } return x; }
function chain(a, b, c, n) { var x = 0; for (var i = 0; i < n; i++) x = x + a[b[c[i]]] | 0; return x; }
function sparse(a, b, n) { var x = 0; for (var i = 0; i < n; i++) if (a[b[i]] !== undefined) x ^= a[b[i]]; return x; }
function name(a, b, n) { var s = ""; for (var i = 0; i < n; i++) s += a[b[i]]; return s; }
function own(b, n) { var x = 0; for (var i = 0; i < n; i++) x ^= b[b[i]]; return x; }
var n = 16;
function make(f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function changed(a, at, v) { var b = a.slice(); b[at] = v; return b; }
var keys = make(function (i) { return i * 5 % 16; }), ints = make(function (i) { return Math.imul(i + 3, 0x9e3779b9) >> 2; }), doubles = make(function (i) { return i * 1.25 - 3; });
var places = {
  ints: keys, doubles: keys.map(function (k) { return k + 0; }).concat([0.5]), fractions: changed(keys, 3, 2.5), negative: changed(keys, 3, -1), minusZero: changed(keys, 3, -0), past: changed(keys, 3, 99), large: changed(keys, 3, 2147483648), larger: changed(keys, 3, 4294967295), huge: changed(keys, 3, 1e300), nan: changed(keys, 3, NaN),
  hole: (function () { var b = keys.slice(); delete b[4]; return b; })(), string: changed(keys, 3, "7"), word: changed(keys, 3, "length"), nothing: changed(keys, 3, undefined), symbol: changed(keys, 3, Symbol.iterator), object: changed(keys, 3, { toString: function () { log.push("asked"); return "6"; } }),
  frozen: Object.freeze(keys.slice()), bytes: new Uint8Array(keys), floats: new Float64Array(keys), below: Places.from(keys), literal: [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3], text: "0123456789", short: [1, 2], getter: Object.defineProperty(keys.slice(), 5, { get: function () { log.push("got"); return 2; } }), proxy: new Proxy(keys.slice(), { get: function (t, k) { if (k === "2") log.push("trap"); return t[k]; } })
};
var tables = { ints: ints, doubles: doubles, holes: (function () { var a = ints.slice(); delete a[5]; return a; })(), frozen: Object.freeze(ints.slice()), bytes: new Uint8Array(ints), words: make(function (i) { return "w" + i; }), short: [1.5], keyed: changed(ints, 2.5, 77), above: Object.create({ 99: 5 }), below: Places.from(doubles) };
function show(f) { try { var v = f(); return Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (error) { return "threw " + error.name; } }
for (var p in places) for (var t in tables) {
  var b = places[p], a = tables[t];
  console.log(p, t, [
    show(function () { return sum(a, b, n); }), show(function () { return fold(a, b, n); }), show(function () { return boxes([a, ints, doubles], b, n, 7); }), show(function () { return dot(doubles, a, b, n); }),
    show(function () { return gather(a, b, [], n); }), show(function () { return gather(a, b, ints.slice(), n); }), show(function () { return scatter(a, b, doubles.slice(), n); }), show(function () { return count(b, ints.slice(), n); }),
    show(function () { return changes(a, Array.from(b), n, 9, p === "ints" ? 1.5 : 3); }), show(function () { return chain(a, b, keys, n); }), show(function () { return sparse(a, b, n); }), show(function () { return name(a, b, n); }), show(function () { return own(b, n); })
  ].join(" | "), log.splice(0).join());
}
