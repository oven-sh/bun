// Views read and written under elements of plain arrays (v[b[i]]): the elements may be fractions, negative, past the end, holes, strings or objects, the views of any class, of one buffer, detached or resized, and all may change on the way.
"use strict";
var log = [], n = 20;
function make(f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function changed(a, at, v) { var b = a.slice(); b[at] = v; return b; }
function inDoubles(a) { var b = a.slice(); for (var i = 0; i < b.length; i++) b[i] += .5; for (var i = 0; i < b.length; i++) b[i] -= .5; return b; }
function dump(t) { var s = t.length + ":"; for (var i = 0; i < 22; i++) s += (i in t ? (Object.is(t[i], -0) ? "-0" : String(t[i])) : "_") + ","; return s; }
var f = {
  sum(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) s += a[b[i]]; return s; },
  xor(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) s ^= a[b[i]]; return s; },
  dot(h, n) { var a = h.doubles, b = h.index, v = h.weights, s = 0; for (var i = 0; i < n; i++) s += v[i] * a[b[i]]; return s; },
  permute(h, n) { var a = h.list, b = h.index, t = h.other; for (var i = 0; i < n; i++) t[b[i]] = a[i]; return dump(t); },
  gather(h, n) { var a = h.list, b = h.index, t = h.other; for (var i = 0; i < n; i++) t[i] = a[b[i]]; return dump(t); },
  count(h, n) { var t = h.other, b = h.index; for (var i = 0; i < n; i++) t[b[i]]++; return dump(t); },
  add(h, n) { var t = h.doubles, b = h.index, v = h.weights; for (var i = 0; i < n; i++) t[b[i]] += v[i]; return dump(t); },
  chain(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) s = s + a[b[b[i]]] | 0; return s; },
  some(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) if (i & 3) s ^= a[b[i]]; else s += b[i]; return s; },
  rows(h, n) { var a = h.list, b = h.index, s = 0; for (var k = 0; k < 3; k++) for (var i = 0; i < n; i++) s = s + a[b[i]] * k | 0; return s; },
  both(h, n) { var a = h.list, b = h.index, d = h.doubles, s = 0; for (var i = 0; i < n; i++) { var at = b[i]; s += a[at] + d[at]; } return s; },
  leaves(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) { var at = b[i]; if (at > 17) break; if (at < 0) throw new RangeError(at); s += a[at]; } return s; },
  moves(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) { s += a[b[i]]; if (i === 5) b[9] = h.late; if (i === 11) h.act(); } return s; },
  inTurns(h, n) { var a = h.list, b = h.index, s = ""; for (var i = 0; i < n; i++) { s += a[b[i]] + ";"; if (i === 7) a = h.other; } return s; },
  store(h, n) { var t = h.other, b = h.index, v = h.weights, s = 0; for (var i = 0; i < n; i++) { t[b[i]] = v[i]; s += b[i]; } return s + dump(t); },
  bits(h, n) { var a = h.list, b = h.index, s = 0; for (var i = 0; i < n; i++) s ^= a[b[i] & 15] << 1 ^ a[b[i] + 1]; return s; },
};
var keys = make(function (i) { return i * 7 % 20; });
function ordinary() { var h = { list: new Int32Array(make(function (i) { return Math.imul(i + 3, 0x9e3779b9) >> 2; })), index: keys.slice(), other: new Int32Array(n), doubles: new Float64Array(make(function (i) { return i * 1.25 - 3; })), weights: make(function (i) { return i * .25; }), late: 3, act: function () { } }; return h; }
var indexes = {
  doubles: inDoubles(keys), fraction: changed(inDoubles(keys), 3, 2.5), negative: changed(keys, 3, -1), minusZero: changed(inDoubles(keys), 0, -0), past: changed(keys, 3, 99), large: changed(inDoubles(keys), 3, 2147483648), wraps: changed(inDoubles(keys), 3, 4294967298),
  huge: changed(inDoubles(keys), 3, 1e300), nan: changed(inDoubles(keys), 3, NaN), hole: (function () { var b = keys.slice(); delete b[4]; return b; })(), holeInDoubles: (function () { var b = inDoubles(keys); delete b[4]; return b; })(), string: changed(keys, 3, "7"), word: changed(keys, 3, "length"),
  zero: changed(keys, 3, "-0"), nothing: changed(keys, 3, undefined), none: changed(keys, 3, null), flag: changed(keys, 3, true), symbol: changed(keys, 3, Symbol.iterator), object: changed(keys, 3, { toString: function () { log.push("asked"); return "6"; } }), large64: changed(keys, 3, 5n), frozen: Object.freeze(keys.slice()),
  words: new Uint16Array(keys), floats: new Float64Array(changed(keys, 3, 2.5)), short: [1, 2], empty: [], below: (class extends Array {}).from(keys), getter: Object.defineProperty(keys.slice(), 5, { get: function () { log.push("get"); return 2; } }), proxy: new Proxy(keys.slice(), { get: function (t, k) { if (k === "6") log.push("trap"); return t[k]; } }), text: "0123456789", likes: { 0: 4, 1: 2, length: 2 },
};
function viewOf(View, value) { return new View(make(function (i) { return value(i); })); }
function detached() { var v = viewOf(Int32Array, function (i) { return i; }); structuredClone(v.buffer, { transfer: [v.buffer] }); return v; }
function resized(length) { var buffer = new ArrayBuffer(4 * n, { maxByteLength: 8 * n }), v = new Int32Array(buffer); for (var i = 0; i < n; i++) v[i] = i * 3; buffer.resize(length); return v; }
var views = {
  bytes: function () { return viewOf(Uint8Array, function (i) { return i * 31; }); }, clamped: function () { return viewOf(Uint8ClampedArray, function (i) { return i * 31 - 50; }); }, shorts: function () { return viewOf(Int16Array, function (i) { return i * 4001; }); }, unsigned: function () { return viewOf(Uint32Array, function (i) { return i * 0x2fffffff; }); },
  floats: function () { return viewOf(Float32Array, function (i) { return i * .1; }); }, doubles: function () { return viewOf(Float64Array, function (i) { return i === 4 ? NaN : i === 5 ? -0 : i * .1; }); }, big: function () { return viewOf(BigInt64Array, function (i) { return BigInt(i); }); }, plain: function () { return make(function (i) { return i * 5; }); }, plainDoubles: function () { return make(function (i) { return i * .5; }); },
  words: function () { return make(function (i) { return "w" + i; }); }, text: function () { return "abcdefghijklmnopqrst"; }, nothing: function () { return undefined; }, none: function () { return null; }, number: function () { return 7; }, proxy: function () { return new Proxy(viewOf(Int32Array, function (i) { return i; }), { get: function (t, k) { if (k === "6") log.push("trapped"); return t[k]; } }); },
  detached: detached, grown: function () { return resized(6 * n); }, shrunk: function () { return resized(40); }, gone: function () { return resized(0); }, below: function () { return new (class extends Int32Array {})(keys); }, named: function () { var v = viewOf(Int32Array, function (i) { return i + 9; }); v.word = 4; return v; }, shared: function () { var v = new Int32Array(new SharedArrayBuffer(4 * n)); v[3] = 8; return v; }, short: function () { return new Int32Array(5); }, empty: function () { return new Int32Array(0); },
};
function show(v) { return Object.is(v, -0) ? "-0" : typeof v + String(v); }
function run(name, h, m) { var answer; try { answer = show(f[name](h, m)); } catch (error) { answer = "threw " + error.name; } return answer + (log.length ? " " + log.splice(0).join() : ""); }
function put(h, name, v) { h[name] = v; return h; }
for (var name in f) {
  var lines = [];
  for (var turn = 0; turn < 3; turn++) lines.push(run(name, ordinary(), turn === 2 ? 25 : n));
  for (var p in indexes) lines.push(p + " " + run(name, put(ordinary(), "index", indexes[p].slice && Array.isArray(indexes[p]) && indexes[p].constructor === Array && !Object.getOwnPropertyDescriptor(indexes[p], 5)?.get ? indexes[p].slice() : indexes[p]), n));
  for (var p in views) for (var field of ["list", "other", "doubles"]) lines.push(p + "." + field + " " + run(name, put(ordinary(), field, views[p]()), n));
  var h = ordinary(); h.other = h.list; lines.push("one " + run(name, h, n));
  h = ordinary(); h.other = new Int32Array(h.list.buffer, 4, n - 1); lines.push("overlapping " + run(name, h, n));
  h = ordinary(); h.doubles = new Float64Array(h.list.buffer); lines.push("as doubles " + run(name, h, n));
  h = ordinary(); h.weights = h.index; lines.push("weights " + run(name, h, n));
  for (var act of [function (h) { h.index.length = 9; }, function (h) { h.index[7] = 2.5; h.index[8] = "3"; }, function (h) { structuredClone(h.other.buffer, { transfer: [h.other.buffer] }); }]) { h = ordinary(); h.weights[4] = { valueOf() { log.push("value"); act(h); return 2; } }; lines.push("value " + run(name, h, n)); }
  h = ordinary(); h.late = 2.5; lines.push("late fraction " + run(name, h, n));
  h = ordinary(); h.late = "7"; lines.push("late string " + run(name, h, n));
  h = ordinary(); h.late = { toString() { log.push("late"); return "3"; } }; lines.push("late object " + run(name, h, n));
  h = ordinary(); h.act = function () { structuredClone(h.list.buffer, { transfer: [h.list.buffer] }); }; lines.push("detached on the way " + run(name, h, n));
  h = ordinary(); h.list = resized(6 * n); h.act = function () { h.list.buffer.resize(16); }; lines.push("shrunk on the way " + run(name, h, n));
  h = ordinary(); h.act = function () { h.index.length = 13; }; lines.push("cut on the way " + run(name, h, n));
  h = ordinary(); h.act = function () { Object.defineProperty(h.index, 14, { get() { log.push("got"); return 1; } }); }; lines.push("getter on the way " + run(name, h, n));
  console.log(name + "\n  " + lines.join("\n  "));
}
