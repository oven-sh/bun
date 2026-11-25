// new Int32Array(array) and new Uint32Array(array): arrays of every kind and length, what stands above them.
"use strict";
const log = [];
function fill(n, f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const word = i => Math.imul(i + 1, 0x9e3779b9) | 0;
function ints(a) { return new Int32Array(a); }
function words(a) { return new Uint32Array(a); }
function at(n, place, value) { return () => { const a = fill(n, word); a[place] = value; return a; }; }
const kinds = {
  one: () => [7], ints: () => fill(16, word), many: () => fill(255, word), full: () => fill(256, word), over: () => fill(257, word), far: () => fill(5000, word), empty: () => [], whole: () => fill(9, i => word(i) >>> 0), doubles: () => fill(9, i => i * 1.5 - 4), boxed: () => [1, "2", 3.5, -0, NaN, true],
  hole: () => { const a = fill(9, word); delete a[4]; return a; }, holes: () => new Array(12), tail: () => { const a = fill(4, word); a.length = 9; return a; }, large: at(9, 3, 1099511627776 + 2147483648), past: at(9, 5, 9007199254740993), huge: at(9, 1, 1e21), below: at(9, 8, -1e300), edge: at(9, 2, 4611686018427387904), edge2: at(9, 2, -4611686018427387904), near: at(9, 2, 4611686018427387392), max: at(9, 0, 9223372036854775807), minus: at(9, 6, -1099511627779.75), infinite: at(9, 7, -Infinity), nan: at(9, 0, NaN), zero: at(9, 0, -0),
  nothing: at(9, 5, undefined), none: at(9, 5, null), truth: at(9, 5, true), text: at(9, 5, "0x1f"), big: at(9, 5, 1n), symbol: at(9, 5, Symbol("s")), object: at(9, 5, { valueOf() { log.push("asked"); return 6; } }), nested: at(9, 5, [8]), shrinks: () => { const a = fill(9, word); a[2] = { valueOf() { a.length = 3; return 6; } }; return a; },
  frozen: () => Object.freeze(fill(9, word)), sealed: () => Object.seal(fill(9, i => i / 2)), getter: () => Object.defineProperty(fill(9, word), 3, { get() { log.push("got"); return 2; } }), named: () => Object.assign(fill(9, word), { name: 1 }), heir: () => { class List extends Array { } return List.from(fill(9, word)); }, iterated: () => Object.assign(fill(9, word), { [Symbol.iterator]: function* () { yield 4; yield 5; } }), proto: () => Object.setPrototypeOf(fill(9, word), { __proto__: Array.prototype }), bare: () => Object.setPrototypeOf(fill(3, word), null),
  proxy: () => new Proxy(fill(4, word), { get(a, key) { log.push(String(key)); return a[key]; } }), like: () => ({ length: 3, 0: 1, 2: "9" }), set: () => new Set([3, 4]), view: () => new Float64Array([1.5, -2.5, 1e10]), bytes: () => new Uint8Array(5), buffer: () => new ArrayBuffer(16), number: () => 6, string: () => "12", sparse: () => { const a = []; a[70000] = 1; return a; },
};
function show(f) { try { const v = f(); return Object.prototype.toString.call(v) + v.length + ":" + v.byteLength + ":" + v.byteOffset + ":" + v.buffer.byteLength + "[" + Array.from(v.subarray(0, 300)).join() + "]"; } catch (error) { return "threw " + error.name; } }
function round(label) {
  for (const name in kinds) {
    let h = 0, s = "";
    for (let turn = 0; turn < 3; turn++) s += show(() => ints(kinds[name]())) + show(() => words(kinds[name]())) + " ";
    for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) | 0;
    console.log(label, name, h, s.length, log.splice(0).join().length, s.slice(0, 90));
  }
}
round("plain");
const mine = ints(fill(8, word)), kept = []; for (let i = 0; i < 20000; i++) { const v = words([i, i + 1, -i]); if (i % 4000 === 0) kept.push(v); } console.log(mine.join(), kept.map(v => v.join()).join(" "));
