// Relations between BigInts and numbers: borders of int32, of exact doubles and of one digit, fractions, -0, NaN and the infinities, and what is neither.
const log = [];
const bigInts = [0n, 1n, -1n, 2n, -2n, 3n, 2n ** 31n, 2n ** 31n - 1n, -(2n ** 31n), -(2n ** 31n) - 1n, 2n ** 32n, 2n ** 52n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, -(2n ** 53n), -(2n ** 53n) - 1n, 2n ** 63n, -(2n ** 63n), 2n ** 64n - 1n, 2n ** 64n, -(2n ** 64n), 10n ** 40n, -(10n ** 40n)];
const numbers = [0, -0, 1, -1, 2, 3, 0.5, -0.5, 1.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 2 ** 52, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 63, -(2 ** 63), 2 ** 64, 1e40, -1e40, 1e300, NaN, Infinity, -Infinity, 5e-324];
const others = ["1", "x", "", "9007199254740993", true, false, null, undefined, { valueOf() { log.push("b"); return 1n; } }, { valueOf() { log.push("n"); return 1.5; } }, [2], new Date(5)];
function less(a, b) {
  return a < b;
}
function lessEq(a, b) {
  return a <= b;
}
function greater(a, b) {
  return a > b ? 1 : 0;
}
function greaterEq(a, b) {
  if (a >= b) return 1;
  return 0;
}
function compareAll(left, right) {
  const rows = [];
  for (let i = 0; i < left.length; i++) {
    let bits = "", count = 0;
    for (let j = 0; j < right.length; j++) {
      bits += (left[i] < right[j] ? 1 : 0) + (left[i] <= right[j] ? 2 : 0) + (left[i] > right[j] ? 4 : 0) + (left[i] >= right[j] ? 8 : 0) + ".";
      count += left[i] > right[j] ? 1 : 0;
      while (left[i] >= right[j]) {
        count += 100;
        break;
      }
      const called = (less(left[i], right[j]) ? 1 : 0) + (lessEq(left[i], right[j]) ? 2 : 0) + greater(left[i], right[j]) * 4 + greaterEq(left[i], right[j]) * 8;
      bits += called + " ";
    }
    rows.push(bits + count);
  }
  return rows.join("\n");
}
for (let round = 0; round < 2; round++) {
  console.log(compareAll(bigInts, numbers));
  console.log(compareAll(numbers, bigInts));
  console.log(compareAll(bigInts, bigInts));
  console.log(compareAll(bigInts, others), log.splice(0).length);
  console.log(compareAll(others, bigInts), log.splice(0).length);
  console.log(compareAll([...bigInts.slice(0, 9), ...numbers.slice(0, 9)], [...numbers.slice(5, 16), ...bigInts.slice(5, 16)]));
}
try {
  console.log(less(1n, Symbol()));
} catch (e) {
  console.log(e.name);
}
const l = [1n, 2, 3n, 4];
let n = 0;
for (let k = 0; k < 1000; k++) n += l[k & 3] > l[(k + 1) & 3] ? 1 : 0;
console.log(n);
