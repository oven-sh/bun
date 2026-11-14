// STATISTIC: HalvedBoundsCarried >= 2
// do { middle = (low + high) >>> 1; .. } while (low < high): the bounds meet at the back edge.
function ascending(a, b) {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}
function left(a, x, lo = 0, hi = a.length) {
  if (lo < hi) {
    if (ascending(x, x) !== 0) return hi;
    let iterations = 0;
    do {
      if (iterations++ > 80) return "endless";
      const mid = (lo + hi) >>> 1;
      if (ascending(a[mid], x) < 0) lo = mid + 1;
      else hi = mid;
    } while (lo < hi);
  }
  return lo;
}
function right(a, x, lo = 0, hi = a.length) {
  let iterations = 0;
  if (lo < hi) {
    do {
      if (iterations++ > 80) return "endless";
      const mid = lo + ((hi - lo) >> 1);
      if (a[mid] <= x) lo = mid + 1;
      else hi = mid;
    } while (lo < hi);
  }
  return lo;
}
function closed(a, x, lo, hi) {
  let iterations = 0;
  do {
    if (iterations++ > 80) return "endless " + lo + " " + hi;
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else if (a[mid] > x) hi = mid - 1;
    else return mid;
  } while (!(lo > hi));
  return ~lo;
}
const integers = [], fractions = [];
for (let i = 0, at = 0; i < 64; i++) {
  integers.push(at);
  fractions.push(at * 0.5 + 0.25);
  at += (i * 7) % 13 + 1;
}
const show = v => (Object.is(v, -0) ? "-0" : String(v));
for (const a of [integers, fractions, [5], [], ["a", "b", "c"], [, 1, , 9], new Float64Array([1, 4, 9, 16])]) {
  const line = [];
  for (let k = -2; k < 60; k++) line.push(show(left(a, k * 7)), show(right(a, k * 6.5)), show(closed(a, k * 5, 0, a.length - 1)), show(left(a, k, k & 3, a.length)));
  console.log(line.join(" "));
}
const bounds = [undefined, 0, 1, 63, 64, -1, 0.5, 1.5, NaN, -0, "1", "x", null, 2147483647, 1073741823, 1073741824, -1073741825, -2147483648, 1e10, Infinity, -Infinity, true, { valueOf: () => 3 }];
for (const bound of bounds) {
  const line = [show(bound)];
  for (const x of [0, 3, 40, 1e9, NaN, "7", undefined, null]) {
    line.push(show(left(integers, x, bound)), show(left(fractions, x, 0, bound)), show(right(integers, x, bound, 64)), show(right(fractions, x, 1, bound)), show(closed(integers, x, bound, 63)), show(closed(integers, x, 0, bound)));
  }
  console.log(line.join(" "));
}
