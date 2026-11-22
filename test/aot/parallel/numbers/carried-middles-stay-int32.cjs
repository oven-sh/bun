// STATISTIC: HalvedBoundsCarried >= 4
// low = middle + 1; high = middle - 1: what an iteration carries is computed from both bounds. Bounds that enter as numbers of any kind are tested before the loop.
const starts = [];
for (let i = 0, at = 0; i < 64; i++) {
  starts.push(at);
  at += (i * 7) % 13 + 1;
}
const fractions = starts.map(start => start + 0.25);
function byStart(list, wanted, start) {
  let low = start ?? 0, high = list.length - 1;
  for (;;) {
    if (!(low <= high)) return -1 - low;
    const middle = low + ((high - low) >> 1), found = list[middle];
    if (found > wanted) high = middle - 1;
    else if (found < wanted) low = middle + 1;
    else return middle;
  }
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
const heavier = (weight, wanted) => weight > wanted;
const lighter = (weight, wanted) => weight < wanted;
// The shelf on which a weight belongs: what is too heavy and what is too light is asked of two functions, and the answer tells the place and what was found there.
function shelfFor(wanted, isHeavy, isLight, weights, low, high = weights.length - 1) {
  let left = 80;
  while (low <= high) {
    if (left-- === 0) return "endless " + low + " " + high;
    const middle = low + ((high - low) >> 1), weight = weights[middle];
    if (isHeavy(weight, wanted)) high = middle - 1;
    else if (isLight(weight, wanted)) low = middle + 1;
    else return "on " + middle;
  }
  return "between " + high + " and " + low;
}
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const lows = [undefined, 0, 1, 7, null, 63, 64, -1, 0.5, 1.5, NaN, -0, "1", "x", 2147483647, 1073741823, 1073741824, -1073741825, -2147483648, 1e10, Infinity, true, { valueOf: () => 3 }];
for (const array of [starts, fractions, [], [5], ["a", "b"], [, 1, , 9], new Int32Array([1, 4, 9, 16])]) {
  const lines = [];
  for (let k = -2; k < 24; k++) {
    for (let at = 0; at < 4; at++) lines.push(show(byStart(array, k * 17, lows[at])), show(byDefault(array, k * 11.5, lows[at] ?? 0)), show(shelfFor(k * 13, heavier, lighter, array, lows[at] ?? 0)), show(byBounds(array, k * 9, lows[at] ?? 0, array.length)));
  }
  console.log(lines.join(" "));
}
for (const low of lows) {
  const line = [show(low)];
  for (const key of [0, 3, 40, 1e9, NaN, "7", undefined]) {
    line.push(show(byStart(starts, key, low)), show(byBounds(starts, key, low, 64)), show(byBounds(starts, key, 0, low)), show(byDefault(fractions, key, low)), show(shelfFor(key, heavier, lighter, starts, low)));
  }
  console.log(line.join(" "));
}
