// A reduce without a start, filter(Boolean) and callbacks of Math in functions that loops of their file call. The arrays get holes, lose their elements and get other storage.
// STATISTIC: CallbackChainsFused >= 6
const one = x => (Array.isArray(x) ? "[" + Array.from(x, (e, k) => (k in x ? one(e) : "_")) + "]" : Object.is(x, -0) ? "-0" : String(x));
class Item { constructor(k) { this.v = k; this.w = k * 1.5; } }
const integers = [5, 2, 9, 0, 7, 3], fractions = [1.5, -0, 2.25, 0, NaN, 4], words = ["a", "", "bb", "0"], rows = [1, 2, 3, 4].map(k => new Item(k)), single = [7];
const fill = i => { if (i < 0) for (let k = 0; k < 9; k++) console.log("never", i * k, "x" + i, i - k, i % (k + 1)); };
function sum(i) { fill(i); const t = integers.reduce((a, x) => a + x); return t; }
function product(i) { fill(i); const t = fractions.reduce((a, x) => a * x + 1); return t; }
function largest(i) { fill(i); const t = integers.reduce((a, x) => Math.max(a, x)); return t; }
function least(i) { fill(i); const t = fractions.reduce((a, x) => Math.min(a, x)); return t; }
function heaviest(i) { fill(i); const r = rows.reduce((a, b) => (a.w > b.w ? a : b)); return r.v; }
function only(i) { fill(i); const t = single.reduce((a, x) => a - x); return t; }
function kept(i) { fill(i); const r = integers.filter(Boolean); return r; }
function keptFractions(i) { fill(i); const r = fractions.filter(Boolean); return r; }
function counted(i) { fill(i); return words.filter(Boolean).length; }
function floors(i) { fill(i); const r = fractions.map(x => Math.floor(x / 2)); return r; }
const attempt = (f, k) => { try { return one(f(k)); } catch (e) { return "!" + e.constructor.name; } };
for (let round = 0; round < 12; round++) {
  const all = [];
  for (let k = 0; k < 3; k++) {
    if (round < 9) all.push(sum(k), one(product(k)), largest(k), one(least(k)), heaviest(k), only(k));
    else all.push(attempt(sum, k), attempt(product, k), attempt(largest, k), attempt(least, k), attempt(heaviest, k), attempt(only, k));
    all.push(one(kept(k)), one(keptFractions(k)), counted(k), one(floors(k)));
  }
  console.log(round, all.join(" "));
  if (round === 2) { delete integers[0]; fractions[4] = 1e300; }
  if (round === 4) { integers[0] = 2147483647; delete fractions[1]; single[0] = -0; }
  if (round === 6) { integers[8] = 0.5; delete rows[0]; words.push("x", ""); single.push(3); }
  if (round === 8) { integers.length = 0; fractions.length = 1; rows.length = 0; words.length = 0; single.length = 0; }
}
