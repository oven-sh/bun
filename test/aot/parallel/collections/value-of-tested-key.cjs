// STATISTIC: MapEntryIndicesCached >= 6
// get() behind has() reads the entry that has() found: the map stays as it is while the loop runs.
"use strict";
function ints(m, count) { let sum = 0; for (let i = 0; i < count; i++) { const k = i * 2; if (m.has(k)) sum += m.get(k); } return sum; }
function words(m, list) { let text = ""; for (const k of list) { if (m.has(k)) text += m.get(k); else text += "-"; } return text; }
function objects(m, list) { let sum = 0; for (const k of list) { if (m.has(k)) { const o = m.get(k); sum += o === undefined ? 100 : o === null ? 1000 : typeof o === "object" ? o.n : 10; } } return sum; }
function either(m, count) { const found = []; for (let i = 0; i < count; i++) { const k = i % 7; const had = m.has(k); const value = m.get(k); found.push(had, value); } return found.join(); }
function halves(m, count) { let sum = 0; for (let i = 0; i < count; i++) { const k = i / 2; if (m.has(k)) sum += m.get(k); } return sum; }
function twice(a, b, count) { let sum = 0; for (let i = 0; i < count; i++) { const k = i; if (a.has(k)) sum += b.has(k) ? a.get(k) - b.get(k) : a.get(k); } return sum; }
const small = new Map([[0, 1], [2, 0.5], [4, 7], [6, -3]]);
const large = new Map(Array.from({ length: 700 }, (_, i) => [i * 4, i]));
const doubles = new Map(Array.from({ length: 300 }, (_, i) => [i * 1.5, i / 4]));
const huge = new Map(Array.from({ length: 40000 }, (_, i) => [i * 2, i & 1023]));
const gone = new Map(Array.from({ length: 64 }, (_, i) => [i, i])); for (let i = 0; i < 64; i += 3) gone.delete(i);
for (const m of [small, large, doubles, huge, gone, new Map()]) console.log(ints(m, 1500), halves(m, 900), twice(m, gone, 70), twice(gone, m, 70));
const letters = "a b c d a é longer b c".split(" ");
const named = new Map([["a", 1], ["b", "two"], ["longer", null], ["é", undefined], ["c", 2147483648]]);
const many = new Map(Array.from({ length: 400 }, (_, i) => ["k" + i, i]));
console.log(words(named, letters), words(many, letters.map((_, i) => "k" + i * 50)), words(many, ["k" + 399, "k", "k400"]), words(new Map(), letters));
const keys = [{}, [], () => 1, {}, named];
const held = new Map([[keys[0], { n: 3 }], [keys[1], undefined], [keys[2], null], [keys[4], 5]]);
console.log(objects(held, keys), objects(held, [...keys, ...keys, {}]), objects(new Map(), keys));
console.log(either(new Map([[0, undefined], [1, null], [3, NaN], [5, -0], [6, "t"]]), 15), either(new Map(Array.from({ length: 50 }, (_, i) => [i, i % 2 ? undefined : i])), 10));
