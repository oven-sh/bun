// Integers of either sign that are shifted right as words, or lose their lowest bit, until nothing is left of them.
// STATISTIC: SumsBoundedByIterations >= 3
function ones(list) { let count = 0; for (let i = 0; i < list.length; i++) { let x = list[i] | 0; while (x) { count += x & 1; x >>>= 1; } } return count; }
function cleared(list) { let count = 0; for (let i = 0; i < list.length; i++) for (let x = list[i] | 0; x; x &= x - 1) count++; return count; }
function weights(list) { let weight = 0, place = 0; for (const value of list) { let x = value | 0; place = 0; while (x) { if (x & 1) weight += place; place++; x >>>= 1; } } return [weight, place]; }
function single(x) { let count = 0; x |= 0; while (x) { count += 3; x >>>= 3; } return count; }
function wide(x) { let count = 0; while (x) { count++; x &= x - 1; } return count; }
function shifted(x) { let count = 0; while (x) { count++; x >>>= 1; if (count === 2) x = -5; if (count > 80) break; } return count; }
function signed(x) { let count = 0; x |= 0; while (x) { count++; x >>= 1; if (count > 40) break; } return count; }
function many(x, start) { let sum = start; x |= 0; while (x) { sum += 2 ** 20; x &= x - 1; } return sum; }
const show = value => Array.isArray(value) ? "[" + value.map(show) + "]" : Object.is(value, -0) ? "-0" : String(value);
const values = [0, 1, -1, 2, -2, 77, -77, 255, 65535, 2147483647, -2147483648, 2147483648, 4294967295, -4294967297, 2 ** 49, -(2 ** 49), 2 ** 53, -(2 ** 53), 0.5, -0.5, NaN, Infinity, "12", null, undefined, [9]];
for (const value of values) console.log(show(value), single(value), wide(value), shifted(value), signed(value), many(value, 0), many(value, 2 ** 53 - 2 ** 20), many(value, 0.5), String(many(value, "x")).slice(0, 60));
for (const list of [values, values.filter(Number.isInteger), new Int32Array([1, -1, 5, -2147483648]), [3, 5, 1023], [-1, -2], []]) console.log(ones(list), cleared(list), show(weights(list)));
