// Accumulators of reduce() that stay int32s, and that leave them.
// STATISTIC: AccumulatorsStartedAsIntegers >= 3
const show = x => Object.is(x, -0) ? "-0" : String(x);
const ints = Array.from({ length: 30 }, (_, i) => (i * 37) % 101 - 20);
const most = list => list.reduce((m, x) => Math.max(m, x), 0), least = list => list.reduce((m, x) => Math.min(m, x), 0), greater = list => list.reduce((m, x) => x > m ? x : m, 0);
const sum = list => list.reduce((s, x) => s + x, 0), half = list => list.reduce((s, x) => s / 2 + x, 0), bits = list => list.reduceRight((s, x) => s ^ x, 1), texts = list => list.reduce((s, x) => s + String(x), 0), last = list => list.reduce((s, x) => x, 0);
function all(turns, ...lists) { let n = 0; for (let k = 0; k < turns; k++) for (const list of lists) n += most(list) + least(list) + greater(list); return n; }
for (const list of [ints, ints.map(x => x / 2), ints.map((x, i) => i % 9 ? x : undefined), ints.map(x => x * 2 ** 27), [2147483647, 1, 2147483647], [-2147483648, -1], [-0], [0, -0], [NaN, 1], [1, , 3], ["7", 2], [], [null, true]])
  console.log([most, least, greater, sum, half, bits, texts, last].map(f => show(f(list))).join(" "), show(all(3, list, ints)));
