// new View(value) of a value that nobody proves: arrays of every kind with holes, fractions, NaN, -0, large and wrong elements, frozen and own iterators, subclasses, proxies, views, buffers, lengths, texts, iterables, objects, nothing.
"use strict";
var log = [];
class Below extends Array {}
class Bytes extends Uint8Array {}
function fill(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
var values = {
  none: () => [], ints: () => [3, 1, -4, 1, 5], doubles: () => [1.5, -2.5, 3e9, -3e9, 4294967296.5], edges: () => [2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740993, 1e300, -1e300], nan: () => [NaN, -0, Infinity, -Infinity, 0.1], clamped: () => [-1, 0.5, 1.5, 2.5, 254.5, 255.5, 256, 1000], halves: () => [65504, 65520, 1e-8, 6.1e-5, -65536],
  holes: () => { var a = [1, 2, 3, 4]; delete a[1]; return a; }, holesOfDoubles: () => { var a = [1.5, 2.5, 3.5]; delete a[0]; return a; }, sized: () => new Array(5), grown: () => { var a = [1]; a.length = 4; return a; }, sparse: () => { var a = []; a[3] = 7; return a; },
  texts: () => ["1", "x", ""], mixed: () => [1, "2", null, undefined, true, { valueOf() { log.push("asked"); return 9; } }], nothing: () => [undefined, undefined], nulls: () => [null, 1], bigints: () => [1n, 2n], symbols: () => [Symbol.iterator], cells: () => [1, 2.5, undefined, -0],
  long: () => fill(300, i => i * 7 - 1000), frozen: () => Object.freeze([1, 2, 3]), sealed: () => Object.seal([1.5, 2]), below: () => Below.from([1, 2, 3]), named: () => { var a = [1, 2]; a.extra = 1; return a; }, getter: () => Object.defineProperty([1, 2, 3], 1, { get() { log.push("got"); return 8; } }), proxy: () => new Proxy([1, 2], { get(t, k) { log.push(String(k)); return t[k]; } }),
  iterated: () => { var a = [1, 2, 3]; a[Symbol.iterator] = function* () { log.push("iterated"); yield 7; }; return a; }, emptyIterator: () => { var a = [1, 2]; a[Symbol.iterator] = undefined; return a; }, literal: () => [8, 9, 10, 11], nested: () => [[1], [2, 3], []],
  view: () => new Float32Array([1.5, -2, 300]), bytes: () => new Uint8Array([1, 2, 255]), own: () => new Bytes([4, 5]), buffer: () => new ArrayBuffer(16), oddBuffer: () => new ArrayBuffer(3), bigView: () => new BigInt64Array(2), detached: () => { var b = new ArrayBuffer(8), v = new Uint8Array(b); structuredClone(b, { transfer: [b] }); return v; },
  length: () => 4, zero: () => 0, fraction: () => 2.5, negative: () => -1, text: () => "3", word: () => "ab", yes: () => true, undef: () => undefined, nul: () => null, set: () => new Set([1, 2, 3]), map: () => new Map([[1, 2]]), generator: () => (function* () { yield 1; yield 2; })(), like: () => ({ length: 2, 0: 5, 1: "6" }), object: () => ({}), fn: () => fill, big: () => 5n, symbol: () => Symbol.iterator
};
function show(v) { return v === undefined ? "u" : Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v); }
function dump(v) { return v.constructor.name + v.length + "/" + v.byteLength + ":" + Array.from(v).slice(0, 40).map(show).join(","); }
function attempt(f) { try { return f(); } catch (error) { return "threw " + error.name; } }
var makers = {
  Int8Array: v => new Int8Array(v), Uint8Array: v => new Uint8Array(v), Uint8ClampedArray: v => new Uint8ClampedArray(v), Int16Array: v => new Int16Array(v), Uint16Array: v => new Uint16Array(v), Int32Array: v => new Int32Array(v), Uint32Array: v => new Uint32Array(v), Float32Array: v => new Float32Array(v), Float64Array: v => new Float64Array(v), BigInt64Array: v => new BigInt64Array(v), BigUint64Array: v => new BigUint64Array(v), Bytes: v => new Bytes(v), byName: v => { var C = [Uint16Array, Float64Array, Bytes][log.length % 3]; return new C(v); }
};
for (var turn = 0; turn < 2; turn++) for (var name in makers) for (var p in values) {
  var source = values[p](), before = Array.isArray(source) ? source.length : 0;
  var out = attempt(() => { var made = makers[name](source); var line = dump(made); if (made.length) { made[0] = made instanceof BigInt64Array || made instanceof BigUint64Array ? 3n : 3.75; line += " " + show(made[0]) + (Array.isArray(source) ? show(source[0] === made[0]) : ""); } return line + " " + (made.buffer !== source) + made.byteOffset; });
  console.log(name, p, out, Array.isArray(source) ? source.length === before : "", log.splice(0).join());
}
