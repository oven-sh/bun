// Nobody says what these loops iterate over, so a list is expected: the value is tested once in front of the loop, a list as lists are made is read by index, and everything else goes by the protocol.
// Each function gets lists, lists that are no longer as they were made, and what is no list at all; a turn makes the list longer or shorter, or changes an element that is still to come.
const say = value => console.log(String(value));
function tell(f) { try { say(f()); } catch (thrown) { say(thrown.name); } }
function joined(x) { let s = ""; for (const v of x) s += "," + String(v); return s; }
function left(x) { let s = ""; for (const v of x) { s += "," + String(v); if (s.length > 6) break; } return s; }
function inside(table, keys) { let s = ""; for (const k of keys) { const x = table[k]; if (x === undefined) continue; for (const v of x) s += k + String(v); } return s; }
function caught(x) { let s = ""; try { for (const v of x) { s += String(v); if (v === 2) throw new Error("stop"); } } catch (thrown) { s += "!"; } return s; }
function grown(x) { let s = ""; let n = 0; for (const v of x) { s += String(v); if (n++ < 2) x.push(n * 10); } return s; }
function shrunk(x) { let s = ""; for (const v of x) { s += String(v); x.pop(); } return s; }
function replaced(x) { let s = ""; for (const v of x) { s += String(v); x[2] = "z"; } return s; }
function pairs(x) { let s = ""; for (const [k, v] of x) s += String(k) + "=" + String(v) + ";"; return s; }
function spread(x) { let n = 0; for (let i = 0; i < 3; i++) n += [...x, i].length; return n; }
function* made(n) { for (let i = 0; i < n; i++) yield i * i; }
let closed = 0;
const own = n => ({ [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= n, value: i++ }), return() { closed++; return {}; } }; } });
class Reversed extends Array { *[Symbol.iterator]() { for (let i = this.length; i--;) yield this[i]; } }
const withOwnWay = [1, 2, 3]; withOwnWay[Symbol.iterator] = function* () { yield "own"; };
const withHoles = [1, , 3]; const frozen = Object.freeze([4, 5]); const doubles = [1.5, 2.5]; const mixed = [1, "two", null, undefined, { toString() { return "five"; } }];
const sparse = []; sparse[5] = "far"; const named = [1, 2]; named.extra = "no element";
const below = [7, 8]; Object.setPrototypeOf(below, { [Symbol.iterator]: function* () { yield "below"; } });
const everything = () => [[], [1], [1, 2, 3], doubles, mixed, withHoles, frozen, sparse, named, withOwnWay, below, Reversed.from([1, 2, 3]), new Set([1, 2, 2, 3]), new Map([["a", 1]]), "text", "\u{1F600}x", made(4), own(4), new Uint8Array([9, 8]), (function () { return arguments; })(1, 2), [1, 2, 3].values(), [1, 2].entries(), new Set([5]).values(), { length: 2, 0: "a", 1: "b" }, null, undefined, 7, true, Symbol.iterator, () => 1];
[joined, left, caught, spread].forEach(f => everything().forEach(x => tell(() => f(x))));
say(closed);
tell(() => inside({ a: [1, 2], b: new Set([3]), c: "xy", e: own(2), f: [] }, ["a", "b", "c", "d", "e", "f"]));
tell(() => inside({ a: 5 }, ["a"]));
tell(() => grown([1, 2])); tell(() => shrunk([1, 2, 3, 4, 5])); tell(() => replaced([1, 2, 3, 4]));
tell(() => pairs([[1, 2], "ab", [3]])); tell(() => pairs(new Map([["k", "v"]]))); tell(() => pairs(Object.entries({ p: 1, q: 2 }))); tell(() => pairs([1]));
