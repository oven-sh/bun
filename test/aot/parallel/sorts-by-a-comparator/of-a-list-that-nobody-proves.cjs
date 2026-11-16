// A comparator that stands in a table sorts lists that nobody proves.
"use strict";
const hide = [v => v][JSON.parse("0")];
const log = [];
function run(name, f) { let out; try { out = f(); } catch (e) { out = e.name + ":" + e.message.slice(0, 40); } console.log(name, JSON.stringify(out), log.length, log.join("").slice(0, 60)); log.length = 0; }
const make = n => Array.from({ length: n }, (_, i) => ({ k: (i * 7919) % 101, i }));
const keys = l => l.map(x => (x === undefined ? "u" : x && x.k !== undefined ? x.k : x));
for (const n of [0, 1, 2, 3, 7, 8, 9, 10, 63, 64, 65, 130]) run("n" + n, () => { const l = make(n); const same = hide(l).sort((a, b) => { log.push(a.i % 10); return a.k - b.k; }) === l; return [same, keys(l).join().length, l.slice(0, 4).map(x => x.i)]; });
for (const answer of [true, false, undefined, null, "1", "x", NaN, -0, 5n, {}, { valueOf() { return -1; } }, Symbol.iterator]) run("answer " + typeof answer, () => keys(hide(make(9)).sort(() => answer)));
for (const c of [null, 5, "x", {}, [], class A {}, Math.max, (() => 1).bind(null), new Proxy((a, b) => a.k - b.k, {}), async (a, b) => 1, function* () {}]) run("comparator " + typeof c, () => keys(hide(make(5)).sort(c)));
const deeds = { throws: l => { throw new RangeError("t"); }, stores: l => { l[0] = "s"; }, grows: l => { l.push("g"); }, shrinks: l => { l.length = 0; }, doubles: l => { l[1] = 0.5; }, holes: l => { delete l[2]; }, freezes: l => { Object.freeze(l); }, names: l => { l.extra = 1; }, accessor: l => { Object.defineProperty(l, 0, { get: () => "a", set() { log.push("S"); }, configurable: true }); }, sorts: l => { l.sort((a, b) => 0); }, far: l => { l[100000] = 1; } };
for (const name of Object.keys(deeds)) run(name, () => { const l = make(12); let n = 0; let said; try { hide(l).sort((a, b) => { if (++n === 5) deeds[name](l); return a.k - b.k; }); } catch (e) { said = e.name; } return [said, n, l.length, keys(l.slice(0, 13))]; });
const lists = { holes: () => [3, , 1, undefined, 2, , undefined], doubles: () => [2.5, -0, 0, 1.5, NaN, -1], texts: () => ["b", "a", "c"], mixed: () => [3, "2", null, 1.5, undefined], sub: () => { class L extends Array {} return L.from([3, 1, 2]); }, frozen: () => Object.freeze([2, 1]), one: () => Object.freeze([1]), args: () => (function () { return arguments; })(3, 1, 2), like: () => ({ length: 3, 0: "c", 1: "a", 2: "b" }), proxy: () => new Proxy([3, 1, 2], { set(t, k, v) { log.push("P"); t[k] = v; return true; } }), typed: () => new Int8Array([3, 1, 2]), sparse: () => { const l = [5]; l[5000] = 1; return l; }, literal: () => [3, 2, 1], text: () => "cab" };
for (const name of Object.keys(lists)) run("list " + name, () => { const l = lists[name](); return keys(Array.from(Array.prototype.sort.call(hide(l), (a, b) => (a < b ? -1 : a > b ? 1 : 0))).slice(0, 8)); });
run("by call", () => keys([].sort.call(hide(make(9)), (a, b) => b.k - a.k)));
run("through apply", () => keys(Array.prototype.sort.apply(hide(make(9)), [(a, b) => b.k - a.k])));
run("own sort", () => { const l = make(3); l.sort = () => "own"; return hide(l).sort((a, b) => 0); });
run("[1].sort({})", () => hide([1]).sort({}));
