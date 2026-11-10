// A loop calls forEach, union and the like on objects of classes below Map and Set, and an own forEach is laid midway: the look stands in front of the typed copy of a loop only where its turns write nothing that it rests on.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class M extends Map { each() { let s = 0; this.forEach((v) => { s += v; }); return s; } }
class S extends Set { each() { let s = 0; this.forEach((v) => { s += v; }); return s; } both(o) { return this.union(o).size + this.intersection(o).size + (this.isSubsetOf(o) ? 1 : 0); } }
class W extends WeakMap { look(k) { return this.get(k); } asks(k) { return this.has(k); } keep(k, v) { return this.set(k, v) === this; } drop(k) { return this.delete(k); } }
const m = new M([[1, 2], [3, 4]]), s = new S([1, 2, 3]), o = new Set([2, 3, 4]), w = new W(), key = {}, none = {};
let sum = 0;
for (let t = 0; t < 400; t++) { sum += m.each() + s.each() + s.both(o) + (w.keep(key, t) ? 1 : 0) + w.look(key) + (w.asks(none) ? 1 : 0) + (w.look(none) === undefined ? 1 : 0); if (t % 50 === 49) sum += w.drop(key) ? 1 : 0; if (t === 200) m.forEach = function () {}; if (t === 300) S.prototype.union = function () { return { size: 1000 }; }; }
console.log(sum);
