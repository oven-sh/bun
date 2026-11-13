// STATISTIC: HalvedBoundsCarried >= 4
// low = middle + 1; high = middle - 1: what an iteration carries is computed from both bounds. Bounds that enter as numbers of any kind are tested before the loop.
const starts = [];
for (let i = 0, at = 0; i < 64; i++) {
  starts.push(at);
  at += (i * 7) % 13 + 1;
}
const fractions = starts.map(start => start + 0.25);
function byOffset(array, key, offset) {
  let low = offset ?? 0;
  let high = array.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const found = array[middle];
    if (found < key) low = middle + 1;
    else if (found > key) high = middle - 1;
    else return middle;
  }
  return ~low;
}
function byBounds(array, key, low, high) {
  let iterations = 0;
  while (low < high) {
    if (iterations++ > 80) return "endless";
    const middle = (low + high) >>> 1;
    if (array[middle] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}
function byDefault(array, key, low = 0, high = array.length) {
  let iterations = 0;
  while (low < high) {
    if (iterations++ > 80) return "endless";
    const middle = (low + high) >> 1;
    if (array[middle] <= key) low = middle + 1;
    else high = middle;
  }
  return low;
}
function identity(x) {
  return x;
}
function compare(a, b) {
  return a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1;
}
function byKey(array, key, select, comparer, offset) {
  let low = offset ?? 0;
  let high = array.length - 1;
  let iterations = 0;
  while (low <= high) {
    if (iterations++ > 80) return "endless " + low + " " + high;
    const middle = low + ((high - low) >> 1);
    switch (comparer(select(array[middle], middle), key)) {
      case -1:
        low = middle + 1;
        break;
      case 0:
        return middle;
      case 1:
        high = middle - 1;
        break;
    }
  }
  return ~low;
}
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const lows = [undefined, 0, 1, 7, null, 63, 64, -1, 0.5, 1.5, NaN, -0, "1", "x", 2147483647, 1073741823, 1073741824, -1073741825, -2147483648, 1e10, Infinity, true, { valueOf: () => 3 }];
for (const array of [starts, fractions, [], [5], ["a", "b"], [, 1, , 9], new Int32Array([1, 4, 9, 16])]) {
  const lines = [];
  for (let k = -2; k < 24; k++) {
    for (let at = 0; at < 4; at++) lines.push(show(byOffset(array, k * 17, lows[at])), show(byDefault(array, k * 11.5, lows[at] ?? 0)), show(byKey(array, k * 13, identity, compare, lows[at])), show(byBounds(array, k * 9, lows[at] ?? 0, array.length)));
  }
  console.log(lines.join(" "));
}
for (const low of lows) {
  const line = [show(low)];
  for (const key of [0, 3, 40, 1e9, NaN, "7", undefined]) {
    line.push(show(byOffset(starts, key, low)), show(byBounds(starts, key, low, 64)), show(byBounds(starts, key, 0, low)), show(byDefault(fractions, key, low)), show(byKey(starts, key, identity, compare, low)));
  }
  console.log(line.join(" "));
}
