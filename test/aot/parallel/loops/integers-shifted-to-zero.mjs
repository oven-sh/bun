// Integers that are shifted right, or lose their lowest bit, until they are zero: what is counted beside them stays an integer.
// STATISTIC: SumsBoundedByIterations >= 4
function ones(n) { let count = 0; while (n) { count += n & 1; n >>>= 1; } return count; }
function cleared(n) { let count = 0; for (; n; n &= n - 1) count++; return count; }
function logarithm(n) { let count = 0; while (n > 1) { n >>= 1; count++; } return count; }
function halves(n) { let count = 0, sum = 0; while (n !== 0) { sum += n; count += 2; n = n >> 1; } return [count, sum]; }
function bytes(n) { const out = []; let count = 0; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; count++; } out.push(n); return [out, count]; }
function zeros(n) { let count = 0; for (let mask = n; mask > 0; mask >>>= 1) { if (!(mask & 1)) count++; if (mask === 77) count -= 5; } return count; }
function down(n) { let count = 0, odd = 0; for (let i = n; i; i--) { count++; if (i & 1) odd++; } return [count, odd]; }
function around(list) { let count = 0; for (let i = 0; i < list.length; i++) { let x = list[i]; while (x) { count += x & 1; x >>>= 1; } } return count; }
function late(n, steps) { let count = 0; while (n > 0) { n >>= steps; count++; if (count > 40) break; } return count; }
function changed(n) { let count = 0; while (n) { count++; n >>= 1; if (count === 2) n = 1000; if (count > 30) break; } return count; }
function weighted(n, by) { let sum = 0; while (n) { sum += by; n >>= 1; } return sum; }
function* stepped(n) { let count = 0; while (n) { count++; yield count; n >>>= 1; } }
const show = value => Array.isArray(value) ? "[" + value.map(show) + "]" : Object.is(value, -0) ? "-0" : String(value);
const values = [0, 1, 2, 3, 77, 127, 128, 255, 1000, 65535, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32 + 5, 2 ** 53, 0.5, 7.9, -0, NaN, Infinity, "12", null, undefined, true, [9]];
const negative = [-1, -2, -77, -(2 ** 31), -(2 ** 31) - 1, -(2 ** 53)];
for (const n of values) {
  const neverArrives = (n | 0) < 0;
  console.log(show(n), [ones, cleared, logarithm, bytes, zeros, changed].map(run => show(run(n))).join(" "), show(late(n, 1)), show(late(n, 32)), [...stepped(n)].length);
  if (!neverArrives) console.log(show(halves(n)), weighted(n, 2 ** 40), weighted(n, 0.5), weighted(n, "x"));
}
for (const n of negative) console.log(n, ones(n), cleared(n), show(bytes(n)), zeros(n), late(n, 3), [...stepped(n)].length);
for (const n of [0, 1, 9, 300]) console.log(show(down(n)));
console.log(around([1, 2, 3, 255, -1, 0, 2.5, "7", NaN, 2 ** 40]), around(new Int32Array([5, -6, 7])), around([7, 8, 1023]));
