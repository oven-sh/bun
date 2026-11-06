// An object with names may get elements: by index keys in its literal, by definitions under a computed key, and by stores. Compiled code makes the first element, adds the next ones and lengthens their storage itself. It asks the run time the first time for each kind of object, behind a collection, and wherever somebody has to be asked or told.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTDefineById") + count("operationAOTDefineField") + count("operationAOTPutByVal") + count("operationAOTPutByValAndCache") + count("operationAOTPutByValAndCacheSloppy") + count("operationAOTPutByValGeneric");
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const show = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "bigint" ? held + "n" : Object.is(held, -0) ? "-0" : held);
function attempt(label, work) { let said; try { said = show(work()); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
function measure(label, make, bound) {
  for (let i = 0; i < 40; i++) make(i);
  const before = asked();
  let text = "";
  for (let i = 0; i < 1000; i++) text = show(make(i)) + " " + Object.keys(make(i)).join();
  console.log(label + ": " + text + " | " + (asked() - before <= bound));
}
const sloppyStores = new Function("n", "var o = { count: n }; o[0] = n; o[1] = 'one'; o[2] = n + 0.5; return o;");
measure("names then indexes", n => ({ count: n, 2: "b", 3: "c", 4: n }), 100);
measure("indexes then names", n => ({ 0: n, 1: "one", count: n }), 100);
measure("an array-like", n => ({ length: 3, 0: n, 1: n + 0.5, 2: "two" }), 100);
measure("more than the first storage holds", n => ({ name: n, 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11 }), 100);
measure("computed", n => ({ name: n, [0]: "zero", [1]: "computed", [2 + 1]: "sum" }), 100);
measure("downwards", n => ({ name: n, 3: "three", 2: "two", 1: "one", 0: "zero" }), 100);
measure("with holes", n => ({ name: n, 1: "one", 3: "three", 5: "five" }), 100);
measure("stored", n => { "use strict"; const o = { count: n }; o[2] = "b"; o[3] = n; o[4] = null; return o; }, 100);
measure("stored in sloppy code", sloppyStores, 100);
measure("stored in a loop", n => { const o = { count: n }; for (let i = 0; i < 20; i++) o[i] = i + n; return o; }, 100);
measure("every kind of value", n => ({ name: n, 0: n, 1: -0, 2: 0.5, 3: NaN, 4: undefined, 5: null, 6: true, 7: "text" }), 100);
measure("an object in an element", n => ({ name: n, 0: { inner: n, 0: [n] }, 1: { inner: 1, 0: n } }), 100);
measure("stored over", n => { const o = { count: n, 0: "a", 1: "b" }; o[0] = n; o[1] = "B"; o[1] = o[0]; return o; }, 100);
measure("behind collections", n => { if (n % 250 === 0) collect(); return { count: n, 0: n, 1: "one", 2: [n] }; }, 100);

// Here somebody has to be asked or told, or the storage is of another kind. Nothing is pinned.
const calls = [];
const above = { kind: "above" };
Object.defineProperty(above, 1, { get() { calls.push("get"); return "above"; }, set(value) { calls.push("set " + value); }, configurable: true });
Object.defineProperty(above, 2, { value: "fixed above", writable: false, configurable: true });
class Holder { constructor(n) { this.n = n; } 1() { return "method"; } }
for (let round = 0; round < 3; round++) {
  attempt("the first index is far", () => [{ name: round, 8: "eight" }, { name: round, 1000: "far" }, { name: round, 100000: "farther", 0: "near" }, { name: round, 4294967294: "largest", 4294967295: "a name" }]);
  attempt("only indexes", () => [{ 0: "none", 1: round, 2: "two" }, { 5: round }, Object.keys({ 1: "b", 0: "a" })]);
  attempt("keys that are computed", () => ({ name: round, [round & 1]: "computed", [2 + (round & 1)]: "sum", [String(round + 4)]: "text", [round + 0.5]: "half" }));
  attempt("what is no index, behind elements", () => { const o = { name: round, 0: "a", 1: "b", 2: "c" }; o[-1] = "negative"; o[-2147483648] = "least"; o[2147483647] = "large"; o[4294967294] = "largest"; o[4294967295] = "a name"; o[63] = "near"; o[64] = "nearly"; o[65] = "far"; o[1e3] = "farther"; return [Object.keys(o), o[-1], o[63], o[64], o[65], o[4294967294]]; });
  attempt("what is no index, defined behind elements", () => { const k = [-1, -2147483648, 2147483647, 100, 64, 63]; const o = { name: round, 0: "a", [k[0]]: "negative", [k[1]]: "least", [k[2]]: "large", [k[3]]: "far", [k[4]]: "nearly", [k[5]]: "near" }; return [Object.keys(o), o[-1], o[100]]; });
  attempt("negative and fractions", () => { const o = { name: round }; o[-1] = "negative"; o[0.5] = "half"; o[1.0] = "one"; o[-0] = "zero"; return [o, Object.keys(o)]; });
  attempt("below an accessor, defined", () => { const o = { __proto__: above, count: round, 1: "own", 2: "own" }; return [o, o[1], o[2], calls.length]; });
  attempt("below an accessor, stored", () => { const o = { __proto__: above, count: round }; o[0] = "own"; o[1] = "stored"; try { (() => { "use strict"; o[2] = "stored"; })(); } catch (error) { calls.push(error.constructor.name); } return [o, o[1], o[2], calls.join()]; });
  attempt("the prototype comes later", () => { const o = { count: round, 0: "own" }; Object.setPrototypeOf(o, above); o[1] = "stored"; o[3] = "own"; return [o, Object.keys(o), calls.length]; });
  attempt("the prototype goes and comes back", () => { const o = { count: round }; Object.setPrototypeOf(o, above); Object.setPrototypeOf(o, Object.prototype); o[1] = "own"; o[2] = "own"; return [o, calls.length]; });
  attempt("no prototype", () => { const o = { __proto__: null, count: round, 0: "own" }; o[1] = "stored"; return [o[0], o[1], Object.keys(o)]; });
  attempt("an instance of a class", () => { const o = new Holder(round); const before = o[1](); o[0] = "zero"; o[1] = "shadow"; return [before, o, typeof o[1], typeof new Holder(0)[1]]; });
  attempt("as a prototype", () => { const over = { count: round, 0: "over" }; const below = Object.create(over); const before = [below[0], below[1], 1 in below]; over[1] = "late"; over[2] = "later"; return [before, below[1], below[2], 1 in below, Object.keys(below)]; });
  attempt("frozen, sealed, not extensible", () => [Object.freeze, Object.seal, Object.preventExtensions].map(fix => { const o = fix({ count: round, 0: "a" }); o[0] = "A"; o[1] = "b"; let threw = "stored"; try { (() => { "use strict"; o[2] = "c"; })(); } catch (error) { threw = error.constructor.name; } return [o, threw]; }));
  attempt("not extensible before the first element", () => { const o = Object.preventExtensions({ count: round }); o[0] = "a"; let threw = "stored"; try { (() => { "use strict"; o[0] = "a"; })(); } catch (error) { threw = error.constructor.name; } return [o, threw]; });
  attempt("an element that is fixed, an accessor", () => { const o = { count: round, 0: "a", 1: "b" }; Object.defineProperty(o, 0, { value: "fixed", writable: false }); Object.defineProperty(o, 2, { get() { return this.count; }, set(value) { this.count = value; }, enumerable: true }); o[0] = "A"; o[1] = "B"; o[2] = 40 + round; o[3] = "d"; return [o, Object.keys(o)]; });
  attempt("deleted and given again", () => { const o = { count: round, 0: "a", 1: "b", 2: "c" }; delete o[1]; const between = [1 in o, Object.keys(o).join()]; o[1] = "again"; delete o[2]; o[3] = "d"; return [between, o, Object.keys(o)]; });
  attempt("names beside the elements", () => { const o = { count: round, 0: "a" }; o.later = 1; o[1] = "b"; o["more" + round] = 2; o[2] = "c"; o[3] = "d"; o[4] = "e"; return [o, Object.keys(o)]; });
  attempt("many names, then elements", () => { const o = { count: round }; for (let i = 0; i < 12; i++) o["name" + i] = i; for (let i = 0; i < 12; i++) o[i] = i; return [Object.keys(o).join(), o[11], o.name11]; });
  attempt("a symbol beside", () => { const o = { [Symbol.for("mark")]: round, name: round, 0: "own" }; o[1] = "b"; return [o, Object.getOwnPropertySymbols(o).length]; });
  attempt("listed, copied, taken apart", () => { const o = { count: round, 1: "b", 0: "a" }; o[2] = "c"; const { 0: first, count, ...rest } = o; const walked = []; for (const key in o) walked.push(key); return [Object.entries(o), { ...o }, Object.assign({ 5: "kept" }, o), first, count, rest, walked, structuredClone(o), Object.getOwnPropertyDescriptor(o, 2), Reflect.ownKeys(o)]; });
  attempt("as a list", () => { const o = { length: 0 }; Array.prototype.push.call(o, "a", "b"); o[2] = "c"; o.length = 3; return [Array.from(o), Array.prototype.indexOf.call(o, "c"), Array.prototype.pop.call(o), o]; });
  attempt("the same site meets other things", () => { const store = (o, k, v) => { o[k] = v; return o; }; return [store({ count: 1 }, 0, "a"), store([], 0, "a"), store(new Uint8Array(1), 0, 7), store({}, 0, "a"), store(new Map, 0, "a")[0], store(function () { }, 0, "a")[0], store({ count: 1 }, "0", "text key"), store({ count: 1 }, "name", "a name")]; });
}
function neverLeaves(n) { const o = { count: n, 0: n, 1: 2 }; o[2] = n + 1; const list = { length: 2, 0: n, 1: o[2] }; return o[0] + o[1] + o[2] + o.count + list[0] + list[1] + list.length; }
let total = 0;
for (let i = 0; i < 30000; i++) { if (i % 10000 === 0) collect(); total += neverLeaves(i); }
console.log(total);
let sum = 0;
const kept = [];
for (let i = 0; i < 30000; i++) { const o = { count: i, 0: i, 1: "one", 2: { i } }; o[3] = [i]; o[4] = i + 0.5; if (i % 100 === 0) kept.push(o); sum += o[0] + o[1].length + o[2].i + o[3][0] + o[4] + o.count; }
collect();
console.log(sum, kept.length, show(kept[7]), show(kept[299]), kept.every((o, n) => o[2].i === n * 100 && o[3][0] === n * 100 && Object.keys(o).join() === "0,1,2,3,4,count"));
