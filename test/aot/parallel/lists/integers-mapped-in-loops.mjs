// A map of integers stores them without asking for the storage of its result in each iteration. Some callbacks yield what is no int32 in the middle.
// STATISTIC: HoistedInt32ArrayStores >= 2
const one = x => (Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : String(x));
const show = a => { let s = a.length + ":"; for (let k = 0; k < a.length; k++) s += (k in a ? one(a[k]) : "_") + ","; return s; };
const list = [5, 2, 9, 1, 7, 3, 8, 0, 6, 4], limits = [2147483647, 1, -2147483648, 0], words = ["a", "bb", "", "dddd"];
const said = [];
let total = 0;
for (let round = 0; round < 12; round++) {
  const doubled = list.map(x => x * 2), indexed = list.map((x, k) => x - k), negated = list.map(x => -x), shifted = list.map(x => x << 3), lengths = words.map(s => s.length);
  const large = limits.map(x => x * 2), least = limits.map(x => x - round), odd = list.map(x => (x === 7 ? [1, -0, NaN, 2147483648, 1.5, 2 ** 53, -2147483649, 3][round & 7] : x + 1));
  for (const v of doubled) total += v;
  for (let k = 0; k < indexed.length; k++) total += indexed[k];
  for (const v of lengths) total += v;
  for (const v of odd) total += v > 0 ? 1 : 0;
  shifted[0] = 0.5;
  shifted[1] = "q";
  lengths.push(round / 2);
  if (round > 3) said.push(show(doubled), show(indexed), show(negated), show(shifted), show(lengths), show(large), show(least), show(odd));
  if (round === 8) { list[3] = 1.5; delete list[5]; limits.push("7"); words.push("xyz"); }
}
console.log(said.join("\n"), total);
