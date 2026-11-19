// s = s + v[p[q[i]]] | 0 and its kin: the places are int32s, doubles or others, the terms int32s, fractions, large, holes, texts or objects, and both change on the way.
"use strict";
var log = [], n = 20, keys = make(function (i) { return i * 7 % 20; }), ints = make(function (i) { return Math.imul(i + 3, 0x9e3779b9) | 0; });
function make(f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function changed(a, at, v) { var b = a.slice(); b[at] = v; return b; }
class Table {
  constructor(values, places, next) { this.values = values; this.places = places; this.next = next; }
  plus() { let s = 0; for (let i = 0; i < n; i++) s = s + this.values[this.places[i]] | 0; return s; }
  minus() { let s = 5; for (let i = 0; i < n; i++) s = s - this.values[this.places[i]] | 0; return s; }
  from() { let s = 5; for (let i = 0; i < n; i++) s = this.values[this.places[i]] - s | 0; return s; }
  chain() { let s = 0; for (let i = 0; i < n; i++) s = s + this.values[this.next[this.places[i]]] | 0; return s; }
  bits() { let s = 0; for (let i = 0; i < n; i++) s = (s << 5) + this.values[this.places[i]] ^ s >>> 27; return s; }
  unsigned() { let s = 0; for (let i = 0; i < n; i++) s = s + this.values[this.places[i]] >>> 0; return s; }
  two() { let s = 0; for (let i = 0; i < n; i++) s = this.values[this.places[i]] + this.values[this.next[i]] | 0; return s; }
  both() { let s = 0, x = 0; for (let i = 0; i < n; i++) { const v = this.values[this.places[i]]; s = s + v | 0; x += v; } return s + " " + x; }
  stored() { const t = this.values.slice ? this.values.slice() : []; let s = 0; for (let i = 0; i < n; i++) { s = s + t[this.places[i]] | 0; t[i] = s; } return s + " " + t.join(); }
  local(v, p) { let s = 1; for (let i = 0; i < n; i++) s = s * 31 + v[p[i]] | 0; return s; }
  turned(v, p) { let s = 0; for (let i = 0; i < n; i++) { s = s + v[p[i]] | 0; if (i === 9) v[3] = p[4] = this.late; } return s; }
}
var places = { ints: keys, doubles: keys.map(function (k) { return k + .5; }).map(function (k) { return k - .5; }), fraction: changed(keys, 3, 2.5), negative: changed(keys, 3, -1), past: changed(keys, 3, 99), hole: (function () { var b = keys.slice(); delete b[4]; return b; })(), text: changed(keys, 3, "7"), word: changed(keys, 3, "length"), nothing: changed(keys, 3, undefined), object: changed(keys, 3, { toString() { log.push("place"); return "6"; } }), view: new Uint16Array(keys) };
var values = { ints: ints, zeros: make(function () { return -0; }), doubles: make(function (i) { return i * 1.25e9 - 3.5; }), fraction: changed(ints, 5, .5), large: changed(ints, 5, 4294967295), huge: changed(ints, 5, 1e300), exact: changed(ints, 5, 9007199254740993), nan: changed(make(function (i) { return i * .5; }), 5, NaN), infinite: changed(ints, 5, -Infinity), hole: (function () { var b = ints.slice(); delete b[5]; return b; })(), text: changed(ints, 5, "12"), texts: make(function (i) { return "" + i; }), nothing: changed(ints, 5, undefined), none: changed(ints, 5, null), flag: changed(ints, 5, true), big: changed(ints, 5, 4n), object: changed(ints, 5, { valueOf() { log.push("value"); return 9; } }), symbol: changed(ints, 5, Symbol("s")), view: new Int32Array(ints), words: new Uint32Array(ints), frozen: Object.freeze(ints.slice()), above: Object.setPrototypeOf(ints.slice(0, 4), { 7: 70, length: 0 }) };
var names = ["plus", "minus", "from", "chain", "bits", "unsigned", "two", "both", "stored"];
function show(f) { try { var v = f(); return Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (error) { return "threw " + error.name; } }
for (var turn = 0; turn < 2; turn++) for (var v in values) for (var p in places) {
  var table = new Table(values[v], places[p], keys), lines = names.map(function (name) { return show(function () { return table[name](); }); });
  var other = new Table(values[v], keys, places[p]);
  lines.push(show(function () { return other.chain(); }), show(function () { return other.two(); }), show(function () { return table.local(values[v], places[p]); }));
  for (var late of [3, 2.5, "4", undefined, { valueOf() { log.push("late"); return 2; } }]) { table.late = late; lines.push(show(function () { return table.turned(Array.isArray(values[v]) ? values[v].slice() : values[v].slice(), Array.isArray(places[p]) ? places[p].slice() : places[p].slice()); })); }
  console.log(v, p, lines.join(" "), log.splice(0).join());
}
