// Array methods with a callback in functions that loops of their file call. The arrays get holes, other storage and elements that show in which order and how often the callbacks run.
// STATISTIC: CallbackChainsFused >= 5
const said = [];
class Item { constructor(k) { this.v = k; this.w = k * 1.5; this.on = k % 3 === 0; this.name = "n" + k; } }
const spy = n => ({ get v() { said.push("v" + n); return n; }, get w() { said.push("w" + n); return n; }, get on() { said.push("on" + n); return n > 1; }, get name() { said.push("name" + n); return "n" + n; } });
const show = x => Array.isArray(x) ? "[" + Array.from(x, (e, k) => (k in x ? show(e) : "_")).join() + "]" : x instanceof Item ? "#" + x.v : Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{" + Object.keys(x).join() + "}" : String(x);
function sum(list) { let t = 0; for (const x of list) t = typeof x === "number" ? t + x : t + 1; return t; }

function mapped(xs, by) { const r = xs.map(x => x * 2 + by); let t = 0; for (const v of r) t += v; return [t, r]; }
function fractions(xs) { const r = xs.map(x => x / 4); let t = 0; for (const v of r) t += v; return [t, r]; }
function kept(xs, least) { const r = xs.filter(x => x > least); let t = 0; for (const v of r) t += v; return [t, r]; }
function chained(xs) { const r = xs.map(x => x * 2).filter(x => x > 10); let t = 0; for (const v of r) t += v; return [t, r]; }
function indexed(xs) { const r = xs.map((x, k) => x - k).filter((x, k) => x !== k); let t = 0; for (const v of r) t += v; return [t, r]; }
function folded(xs) { const t = xs.reduce((a, x) => a + x, 0.5); let u = 0; for (let k = 0; k < xs.length; k++) u += k; return [t, u]; }
function foldedByIndex(xs) { const t = xs.filter(x => x & 1).reduce((a, x, k) => a + x * k, 0); let u = 0; for (let k = 0; k < xs.length; k++) u += k; return [t, u]; }
function searched(xs, sought) { const r = [xs.some(x => x === sought), xs.every(x => x < 100), xs.find(x => x > sought), xs.findIndex((x, k) => x === k)]; let u = 0; for (let k = 0; k < xs.length; k++) u += k; return [r, u]; }
function names(rows) { const r = rows.map(row => row.name); let t = ""; for (const v of r) t += v; return [t, r]; }
function rowsOn(rows) { const r = rows.filter(row => row.on); let t = 0; for (const row of r) t += row.v; return [t, r]; }
function weights(rows, over) { const r = rows.filter(row => row.w > over).map(row => row.v); let t = 0; for (const v of r) t += v; return [t, r]; }
function foundRow(rows, name) { const r = rows.find(row => row.name === name); let u = 0; for (let k = 0; k < rows.length; k++) u += k; return [r, u, rows.some(row => row.v === 4), rows.reduce((a, row) => a + row.w, 0)]; }
function counted(rows) { let t = 0; rows.forEach(row => { t += row.v; }); for (let k = 0; k < rows.length; k++) t += k; return t; }
function throwing(rows, at) { const r = rows.map((row, k) => { if (k === at) throw new RangeError("at " + k); said.push("m" + k); return row.v; }); let t = 0; for (const v of r) t += v; return t; }
function changing(xs) { const r = xs.map(x => { if (xs.length < 12) xs.push(x); return x; }); let t = 0; for (const v of r) t += v; return [t, xs.length]; }

const integers = () => [5, 2, 9, 1, 7, 3, 8, 0, 6, 4];
const makers = {
  integers, fractions: () => integers().map(x => x * 1.5), mixed: () => [1, 2.5, -0, NaN, 2147483647, 1e10], none: () => [], one: () => [3],
  hole: () => { const a = integers(); delete a[3]; return a; }, texts: () => ["a", "bb", "7"], boxed: () => [1, "2", null, undefined, true], far: () => { const a = [1, 2]; a[40] = 3; return a; }, frozen: () => Object.freeze(integers()),
};
const rowMakers = {
  items: () => Array.from({ length: 8 }, (_, k) => new Item(k)), literals: () => [{ v: 1, w: 2, on: true, name: "n1" }, { v: 4, w: 5, on: false, name: "n4" }], spies: () => [new Item(1), spy(2), new Item(3), spy(4)],
  nullish: () => [new Item(1), null, new Item(3)], gap: () => { const a = [new Item(1)]; a[2] = new Item(3); return a; }, none: () => [],
};
const attempt = (name, f) => { let a; try { a = show(f()); } catch (e) { a = "!" + e.constructor.name; } console.log(name, a, said.join()); said.length = 0; };
for (const [name, make] of Object.entries(makers)) {
  for (let round = 0; round < 3; round++) {
    attempt("mapped " + name, () => mapped(make(), round)); attempt("fractions " + name, () => fractions(make())); attempt("kept " + name, () => kept(make(), round)); attempt("chained " + name, () => chained(make())); attempt("indexed " + name, () => indexed(make()));
    attempt("folded " + name, () => folded(make())); attempt("foldedByIndex " + name, () => foldedByIndex(make())); attempt("searched " + name, () => searched(make(), round)); attempt("changing " + name, () => changing(make()));
  }
}
for (const [name, make] of Object.entries(rowMakers)) {
  for (let round = 0; round < 3; round++) {
    attempt("names " + name, () => names(make())); attempt("rowsOn " + name, () => rowsOn(make())); attempt("weights " + name, () => weights(make(), round)); attempt("foundRow " + name, () => foundRow(make(), "n" + (round + 2)));
    attempt("counted " + name, () => counted(make())); attempt("throwing " + name, () => throwing(make(), round + 1));
  }
}
let total = 0;
const plain = integers(), items = rowMakers.items(), halves = plain.map(x => x * 1.5);
for (let k = 0; k < 4; k++) {
  total += mapped(plain, k)[0] + fractions(halves)[0] + kept(halves, k)[0] + chained(halves)[0] + indexed(plain)[0] + folded(halves)[0] + foldedByIndex(plain)[0] + sum(searched(plain, k)[0]) + names(items)[0].length + rowsOn(items)[0] + weights(items, k)[0] + foundRow(items, "n" + k)[3] + counted(items);
  if (k === 1) { delete plain[2]; items[3] = spy(9); halves[4] = "x"; }
}
console.log(total, said.join());
