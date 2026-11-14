// concat of two arrays and splice of all elements: arrays of every kind and length, holes, literals, frozen and sealed arrays, subclasses, proxies, views, array-likes; results and what is left.
"use strict";
class Below extends Array {}
var log = [];
function fill(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function holes(a) { var b = a.slice(); for (var i = 1; i < b.length; i += 3) delete b[i]; return b; }
function item(v) { return v === undefined ? "u" : typeof v === "function" ? "f" : Object.is(v, -0) ? "-0" : v !== v ? "NaN" : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.length + "]" : "o") : typeof v === "string" ? "'" + v : String(v); }
function dump(a) { var s = (Array.isArray(a) ? a.constructor.name : typeof a) + a.length + ":"; for (var i = 0; i < a.length && i < 90; i++) s += (i in a ? item(a[i]) : "_") + ","; return s; }
function concat(a, b) { return a.concat(b); }
function splice(a, n) { return a.splice(0, n); }
function spliceFrom(a, from, n) { return a.splice(from, n); }
function words(a, b) { var c = a.concat(b); for (var k = c.length + 2; k & 15; k++) c.push(0); c.push(1); c.push(a.length | 0); var s = 0; for (; c.length;) { var block = c.splice(0, 16); for (var i = 0; i < 16; i++) s = s * 31 + block[i] | 0; } return s + "|" + c.length; }
var o = { x: 1 };
var arrays = {
  none: () => [], ints: () => [3, 1, 4, 1, 5], one: () => [7], two: () => [8, 9], doubles: () => fill(6, i => i * 1.5), oneDouble: () => [1.5], big: () => [1099511627776 * 32 + 2147483648], nan: () => [NaN, -0, 1], values: () => ["a", o, null, undefined, 4], oneValue: () => [o],
  holesOfInts: () => holes(fill(9, i => i)), holesOfDoubles: () => holes(fill(9, i => i + .5)), holesOfValues: () => holes(fill(9, i => "s" + i)), lastHole: () => { var a = [1, 2, 3]; a.length = 5; return a; }, sized: () => new Array(4), filled: () => new Array(5).fill(0), emptied: () => { var a = [1, 2, 3]; a.length = 0; return a; },
  sixteen: () => fill(16, i => i * 7), fifteen: () => fill(15, i => i * .25), thirty: () => fill(33, i => i), long: () => fill(64, i => i), longer: () => fill(70, i => i % 3 ? i : "v" + i), frozen: () => Object.freeze([1, 2, 3]), sealed: () => Object.seal([1, 2, 3]), fixed: () => Object.preventExtensions([1, 2.5, 3]), shortRoom: () => { var a = fill(4, i => i); Object.defineProperty(a, "length", { writable: false }); return a; },
  below: () => Below.from([1, 2, 3]), named: () => { var a = [1, 2]; a.name = "n"; return a; }, unspread: () => { var a = [1, 2]; a[Symbol.isConcatSpreadable] = false; return a; }, spread: () => ({ length: 2, 0: "p", 1: "q", [Symbol.isConcatSpreadable]: true }), getter: () => Object.defineProperty([1, 2, 3], 1, { get() { log.push("get"); return 9; }, configurable: true }), proxy: () => new Proxy([1, 2, 3], { get(t, k) { if (k === "1") log.push("trap"); return t[k]; } }),
  sparse: () => { var a = []; a[5] = 1; a[40] = 2; return a; }, own: () => { var a = [1, 2, 3]; a.constructor = function Own(n) { this.length = 0; this.tag = n; }; a.constructor[Symbol.species] = a.constructor; return a; }
};
var others = { view: () => new Int32Array([1, 2]), text: () => "ab", number: () => 5, nothing: () => undefined, object: () => ({ length: 1, 0: 1 }), fn: () => concat };
function show(f) { try { var v = f(); return typeof v === "string" ? v : dump(v); } catch (error) { return "threw " + error.name; } }
for (var turn = 0; turn < 2; turn++) for (var p in arrays) {
  var out = [];
  for (var q in arrays) { var a = arrays[p](), b = arrays[q](); out.push(show(() => concat(a, b)), dump(a), dump(b)); if (a.push && !turn) out.push(show(() => { var c = concat(a, b); c.push(1.5); c.push("t"); c[0] = 2; return dump(c) + dump(a) + dump(b); })); }
  for (var q in others) { var a = arrays[p](), b = others[q](); out.push(show(() => concat(a, b)), q === "text" ? b : ""); }
  var self = arrays[p](); out.push(show(() => concat(self, self)));
  console.log(p, out.join(" "), log.splice(0).join());
  out = [];
  for (var n of [0, 1, 2, 3, 5, 6, 9, 15, 16, 33, 64, 70, 100, -1, 2147483647, 2147483648, 1.5, NaN, "5", undefined, null, Infinity]) { var a = arrays[p](); out.push(show(() => splice(a, n)), dump(a)); out.push(show(() => { splice(a, n).push(1.5); a.push(3); a.push("w"); return a; })); }
  for (var from of [0, -0, 1, -1, -100, 0.5, "0"]) { var a = arrays[p](); out.push(show(() => spliceFrom(a, from, 100)), dump(a)); }
  console.log(p, out.join(" "), log.splice(0).join());
}
for (var p of ["ints", "doubles", "big", "values", "sixteen", "fifteen", "holesOfInts", "filled"]) for (var q of ["none", "one", "big", "two", "doubles", "oneValue"]) console.log(p, q, show(() => words(arrays[p](), arrays[q]())));
