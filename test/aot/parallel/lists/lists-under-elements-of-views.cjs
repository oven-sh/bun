// Plain arrays read, written and updated under elements of views (a[b[i]]): the elements may lie outside, be fractions or negative, the views may be detached or resized, the arrays of any storage, with holes, accessors, frozen or copied on write, and all may change on the way.
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
var keys = make(function (i) { return i * 7 % 20; }), ints = make(function (i) { return Math.imul(i + 3, 0x9e3779b9) >> 2; });
function ordinary() { var h = { list: ints.slice(), index: new Uint16Array(keys), other: make(function () { return 0; }), doubles: make(function (i) { return i * 1.25 - 3; }), weights: make(function (i) { return i * .25; }), late: 3, act: function () { } }; return h; }
function viewOf(View, value) { return new View(make(function (i) { return value(i); })); }
function detached() { var v = new Uint16Array(keys); structuredClone(v.buffer, { transfer: [v.buffer] }); return v; }
function resized(length) { var buffer = new ArrayBuffer(2 * n, { maxByteLength: 8 * n }), v = new Uint16Array(buffer); for (var i = 0; i < n; i++) v[i] = keys[i]; buffer.resize(length); return v; }
var indexes = {
  bytes: new Uint8Array(keys), words: new Int32Array(keys), past: new Uint16Array(changed(keys, 3, 99)), negative: new Int32Array(changed(keys, 3, -1)), large: new Uint32Array(changed(keys, 3, 4294967295)), most: new Uint32Array(changed(keys, 3, 4294967294)), above: new Uint32Array(changed(keys, 3, 2147483648)), fraction: new Float64Array(changed(keys, 3, 2.5)), minusZero: new Float64Array(changed(keys, 0, -0)), nan: new Float64Array(changed(keys, 3, NaN)), wraps: new Float64Array(changed(keys, 3, 4294967298)), floats: new Float32Array(changed(keys, 3, 1e10)),
  big: new BigInt64Array(n), detached: detached(), grown: resized(3 * n), shrunk: resized(10), gone: resized(0), short: new Uint16Array(5), empty: new Uint16Array(0), below: (class extends Uint16Array {}).from(keys), named: (function () { var v = new Uint16Array(keys); v.word = 1; return v; })(), shared: new Uint16Array(new SharedArrayBuffer(2 * n)), proxy: new Proxy(new Uint16Array(keys), { get: function (t, k) { if (k === "6") log.push("trap"); return t[k]; } }),
  plain: keys.slice(), word: changed(keys, 3, "length"), object: changed(keys, 3, { toString: function () { log.push("asked"); return "6"; } }), text: "0123456789", likes: { 0: 4, 1: 2, length: 2 },
};
var views = {
  doubles: function () { return make(function (i) { return i * .5; }); }, words: function () { return make(function (i) { return "w" + i; }); }, mixed: function () { return make(function (i) { return i & 1 ? i : "o" + i; }); }, hole: function () { var b = ints.slice(); delete b[4]; return b; }, holeInDoubles: function () { var b = make(function (i) { return i * .5; }); delete b[4]; return b; }, frozen: function () { return Object.freeze(ints.slice()); }, sealed: function () { return Object.seal(ints.slice()); },
  literal: function () { return [3, 1, 4, 1, 5, 9, 2, 6]; }, fractions: function () { return [1.5, 2.5, 3.5]; }, empty: function () { return []; }, unfilled: function () { return new Array(n); }, below: function () { return (class extends Array {}).from(ints); }, accessor: function () { return Object.defineProperty(ints.slice(), 5, { get: function () { log.push("get"); return 2; }, set: function (v) { log.push("set" + String(v)); } }); }, readOnly: function () { return Object.defineProperty(ints.slice(), 5, { writable: false }); }, lengthKept: function () { return Object.defineProperty(ints.slice(0, 9), "length", { writable: false }); },
  proxy: function () { return new Proxy(ints.slice(), { get: function (t, k) { if (k === "6") log.push("trap"); return t[k]; }, set: function (t, k, v) { if (k === "2") log.push("strap"); t[k] = v; return true; } }); }, text: function () { return "abcdefghijklmnopqrst"; }, nothing: function () { return undefined; }, none: function () { return null; }, number: function () { return 7; }, likes: function () { return { 3: 8, length: 4 }; }, view: function () { return new Int32Array(ints); }, above: function () { return Object.setPrototypeOf(ints.slice(0, 9), { 12: "above", length: 0 }); },
  undefinedInside: function () { return changed(ints, 3, undefined); }, bigInside: function () { return changed(ints, 3, 4n); }, nanInside: function () { return changed(make(function (i) { return i * .5; }), 3, NaN); }, minusZeroInside: function () { return changed(ints, 3, -0); }, objects: function () { return make(function (i) { return { valueOf: function () { log.push(i); return i; } }; }); },
};
function show(v) { return Object.is(v, -0) ? "-0" : typeof v + String(v); }
function run(name, h, m) { var answer; try { answer = show(f[name](h, m)); } catch (error) { answer = "threw " + error.name; } return answer + (log.length ? " " + log.splice(0).join() : ""); }
function put(h, name, v) { h[name] = v; return h; }
for (var name in f) {
  var lines = [];
  for (var turn = 0; turn < 3; turn++) lines.push(run(name, ordinary(), turn === 2 ? 25 : n));
  for (var p in indexes) lines.push(p + " " + run(name, put(ordinary(), "index", indexes[p].constructor === Array ? indexes[p].slice() : indexes[p]), n));
  for (var p in views) for (var field of ["list", "other", "doubles"]) lines.push(p + "." + field + " " + run(name, put(ordinary(), field, views[p]()), n));
  var h = ordinary(); h.other = h.list; lines.push("one " + run(name, h, n));
  h = ordinary(); h.other = h.doubles; lines.push("two " + run(name, h, n));
  h = ordinary(); h.list = h.doubles; lines.push("as doubles " + run(name, h, n));
  h = ordinary(); h.weights = h.index; lines.push("weights " + run(name, h, n));
  for (var act of [function (h) { h.list.length = 9; }, function (h) { h.list[7] = 2.5; h.other[8] = "3"; h.index[9] = 77; }, function (h) { structuredClone(h.index.buffer, { transfer: [h.index.buffer] }); }]) { h = ordinary(); h.weights[4] = { valueOf() { log.push("value"); act(h); return 2; } }; lines.push("value " + run(name, h, n)); }
  h = ordinary(); h.late = 2.5; lines.push("late fraction " + run(name, h, n));
  h = ordinary(); h.late = "7"; lines.push("late string " + run(name, h, n));
  h = ordinary(); h.late = { toString() { log.push("late"); return "3"; } }; lines.push("late object " + run(name, h, n));
  h = ordinary(); h.act = function () { structuredClone(h.index.buffer, { transfer: [h.index.buffer] }); }; lines.push("detached on the way " + run(name, h, n));
  h = ordinary(); h.index = resized(3 * n); h.act = function () { h.index.buffer.resize(16); }; lines.push("shrunk on the way " + run(name, h, n));
  h = ordinary(); h.act = function () { h.list.length = 13; }; lines.push("cut on the way " + run(name, h, n));
  h = ordinary(); h.act = function () { Object.defineProperty(h.list, 14, { get() { log.push("got"); return 1; } }); }; lines.push("getter on the way " + run(name, h, n));
  console.log(name + "\n  " + lines.join("\n  "));
}
