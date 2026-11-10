"use strict";
// STATISTIC: LoopsBuiltForListsAndForBytes >= 3
// STATISTIC: LoopsWithCopyForListsOfAnything >= 1
// The test for a list of numbers asks the class alone. A list that holds texts, objects or holes beside its numbers fails the question for its kind of storage, which is asked in the chain of tests: it goes on to the next member, a list of anything, whose copy reads boxed elements.
const key = JSON.parse('"go"');
const tested = { go(d) { let s = 0; for (let i = 0; i < d.length; i++) if (typeof d[i] === "number") s += d[i]; return s; } };
const hashed = { go(d) { let h = 7; for (let i = 0; i <= d.length; i++) h = (h * 31 + d[i]) | 0; return h; } };
const shortened = { go(d) { let s = 0; for (let i = 0; i < d.length; i++) { s += +d[i] || 0; if (i === 1) d.length = 2; } return s + ":" + d.length; } };
class Row extends Array {}
const sparse = [1, 2]; sparse[100000] = 3;
const withGetter = [1, "b", 3]; Object.defineProperty(withGetter, 1, { get() { return 40; } });
const given = () => [
  [1, "two", 3.5, null, undefined, { valueOf() { return 9; } }, [4], true, 5n === 5n, Symbol.iterator.description],
  [1, , 3, "x"], new Array(4), [], ["only"], [1.5, 2.5], [1, 2], Object.freeze([1, "f"]), Row.from([1, "r", 2]), sparse.slice(0, 3).concat(["t"]),
  withGetter, JSON.parse('[1,"j",[2],{"a":3},null,2.5]'), Array.from({ length: 9 }, (_, i) => (i & 1 ? i : "x" + i)), new Uint8Array([1, 2]), Buffer.from([3]), new Float64Array([0.5]), { length: 2, 0: 1, 1: "o" }, "text",
];
for (const table of [tested, hashed, shortened]) for (const d of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = String(table[key](d)); } catch (e) { said = e.name; } console.log(said); }
const grows = { go(d) { let s = 0; for (let i = 0; i < d.length && i < 8; i++) { s += typeof d[i] === "number" ? d[i] : 100; if (i === 0) d.push("more", 2.5); if (i === 2) d[1] = { toString() { return "o"; } }; } return s; } };
for (let turn = 0; turn < 3; turn++) console.log(grows[key]([1, 2, 3]), grows[key]([1, "a"]), grows[key]([0.5]));
