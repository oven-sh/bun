// Array.from(x.values()) and x.keys(): collections as made, with methods of their own, in loops and outside, the iterator used again, what is no iterable.
"use strict";
class SubSet extends Set {}
class ReversedSet extends Set { values() { return [...super.values()].reverse(); } keys() { return new Set(["k"]); } }
class LengthSet extends Set { values() { return { length: 3, 0: "like" }; } keys() { return { length: 1.5, 0: 2 }; } }
class SelfMap extends Map { values() { return this; } keys() { return this; } }
class SteppedMap extends Map { *values() { yield "first"; yield* super.values(); } *keys() {} }
const constantSet = new Set(["a", "b"]), constantMap = new Map([["a", 1], ["b", undefined], [3, "three"]]), integers = new Set([1, 2, 3]), fractions = new Map([[1.5, -0], [2.5, NaN]]);
const own = new Set([1]); own.values = () => ["own"];
const noIterator = new Set([1, 2]); noIterator[Symbol.iterator] = undefined;
const thinned = new Set([1, "gone", 2, "gone too", 3]); thinned.delete("gone"); thinned.delete("gone too");
const thinnedMap = new Map([[1, 1], ["gone", 2], [3, "x"]]); thinnedMap.delete("gone");
const make = () => [constantSet, constantMap, integers, fractions, own, noIterator, thinned, thinnedMap, new Set(), new Map(), new SubSet([1, "x", null]), new ReversedSet([1, 2, 3]), new LengthSet([9]), new SelfMap([["k", "v"]]), new SteppedMap([[1, "v"]]),
  new Set([0.5, 1, -0, NaN]), new Set([1n, Symbol.iterator, undefined]), [5, , 7], new Uint8Array([1, 300]), { values() { return [1, 2]; }, keys() { return { length: 2, 0: "x" }; } }, { values() { return 5; }, keys() { return "text"; } }, { values() { return null; }, keys() {} }, { values: 1 }, null];
const tell = v => Array.isArray(v) ? "[" + v.map((e, i) => (i in v ? tell(e) : "hole")).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "object" : typeof v === "symbol" ? v.description : String(v);
const log = [];
const note = f => { try { log.push(tell(f())); } catch (e) { log.push(e.constructor.name + ": " + e.message); } };
const values = x => Array.from(x.values());
const keys = x => Array.from(x.keys());
function inLoop(list) { let s = ""; for (let i = 0; i < list.length; i++) { const copy = Array.from(list[i].values()); copy.push(i); s += copy.length + tell(copy); } return s; }
function keysInLoop(list) { let s = ""; for (const x of list) s += tell(Array.from(x.keys())); return s; }
function usedAgain(x) { const iterator = x.values(); const copy = Array.from(iterator); return [copy, iterator.next ? iterator.next().done : "none", Array.from(iterator).length]; }
function inTry(x) { try { return Array.from(x.keys()); } catch (e) { return [e.constructor.name]; } finally { log.push("finally"); } }
class Holder { constructor(x) { this.items = x; } list() { return Array.from(this.items.values()); } both() { return [Array.from(this.items.keys()), Array.from(this.items.values())]; } }
function proven() { const s = new Set(), m = new Map(); let t = ""; for (let i = 0; i < 5; i++) { s.add(i % 2 ? i : "t" + i); m.set(s.size, i / 2); t += tell(Array.from(s.values())) + tell(Array.from(s.keys())) + tell(Array.from(m.values())) + tell(Array.from(m.keys())); } return t; }
class Kept { constructor() { this.set = new Set(["x", "y"]); this.map = new Map([["k", 1]]); } told() { let t = ""; for (let i = 0; i < 3; i++) t += tell(Array.from(this.set.values())) + tell(Array.from(this.map.keys())) + tell(Array.from(this.map.values())) + tell(Array.from(this.set)); return t; } }
const sometimes = new Set([1, 2]), sometimesMap = new Map([[1, 2]]), kept = new Kept();
function ofSometimes() { let t = kept.told(); for (let i = 0; i < 3; i++) t += tell(Array.from(sometimes.values())) + tell(Array.from(sometimesMap.keys())) + tell(Array.from(sometimes)); return t; }
const ownMethods = { values: () => ["mine"], keys: () => new Set(["my key"]), [Symbol.iterator]: function* () { yield "my own"; } };
const changes = [x => Object.assign(x, ownMethods), x => { x.values = function* () { yield "stepped"; }; x.keys = x.values; }, x => Object.setPrototypeOf(x, x instanceof Set ? ReversedSet.prototype : SelfMap.prototype), x => { x.other = 1; }, x => Object.freeze(x)];
const restore = x => { if (Object.isFrozen(x)) return; delete x.values; delete x.keys; delete x[Symbol.iterator]; delete x.other; Object.setPrototypeOf(x, x instanceof Set ? Set.prototype : Map.prototype); };
for (const change of changes) for (const x of [sometimes, sometimesMap, kept.set, kept.map]) { note(ofSometimes); note(() => { change(x); return 1; }); note(ofSometimes); restore(x); note(ofSometimes); }
const firstSet = new Set([1, 2]), firstMap = new Map([[1, 2], [3, 4]]);
function countFirst() { let t = 0; for (let i = 0; i < 3; i++) t += Array.from(firstSet.values()).length * 100 + Array.from(firstMap.keys()).length * 10 + Array.from(firstMap.values()).length; return t; }
note(countFirst); Object.assign(firstSet, { values: () => ["mine"] }); Object.assign(firstMap, { keys: () => new Set(["k"]), values: () => [7, 8, 9] }); note(countFirst);
class Second { constructor() { this.items = new Set(["a", "b"]); } count(n) { let t = ""; for (let i = 0; i < n; i++) t += Array.from(this.items.values()).join(); return t; } }
const second = new Second(); note(() => second.count(3)); second.items.values = function* () { yield "own"; }; note(() => second.count(3)); note(() => new Second().count(2));
for (let round = 0; round < 3; round++) {
  const list = make();
  for (const x of list) { note(() => values(x)); note(() => keys(x)); note(() => usedAgain(x)); note(() => inTry(x)); note(() => new Holder(x).list()); note(() => new Holder(x).both()); }
  note(() => inLoop(list)); note(() => keysInLoop(list)); note(() => inLoop(list.slice(0, 4))); note(() => inLoop([new Set([1]), new Set(["x", 2]), new Set([0.5])])); note(() => keysInLoop([new Map([[1, 2]]), new Map([["a", {}]])])); note(proven);
}
console.log(log.join("\n"));
