// STATISTIC: CopiedBinarySearchesVersioned >= 1
// A binary search that calls its parameters is copied into its callers: the copy tests its bounds before the loop too.
function identity(x) {
  return x;
}
function position(node) {
  return node === undefined ? undefined : node.pos;
}
function compare(a, b) {
  return a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1;
}
function search(array, key, select, comparer, offset) {
  if (!array || array.length === 0) return -1;
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
function lineOf(starts, at, lowerBound) {
  let line = search(starts, at, identity, compare, lowerBound);
  if (line < 0) line = ~line - 1;
  return line;
}
function nodeAt(nodes, at, from) {
  return search(nodes, at, position, compare, from);
}
const starts = [];
for (let i = 0, at = 0; i < 50; i++) {
  starts.push(at);
  at += (i * 7) % 13 + 1;
}
const nodes = starts.map(pos => ({ pos }));
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const froms = [undefined, 0, 7, 49, 50, null, -1, 0.5, 1.5, NaN, -0, "1", "x", 2147483647, 1073741823, 1073741824, -1073741825, -2147483648, 1e10, Infinity, -Infinity, true];
for (const from of froms) {
  const line = [show(from)];
  for (let at = -3; at < 330; at += from === undefined || from === 0 ? 1 : 37) line.push(show(lineOf(starts, at, from)), show(nodeAt(nodes, at, from)));
  console.log(line.join(" "));
}
for (const array of [[], undefined, [5], ["a", "b", "c"], [0.5, 1.5, 2.5], [, 1, , 9], new Int32Array([1, 4, 9, 16])]) {
  console.log([0, 1, 2.5, "b", undefined, NaN].map(at => show(lineOf(array, at))).join(" "));
}
let seen = 0;
console.log(show(search(starts, 100, (x, i) => (i === 12 && (starts.length = 20), seen++, x), compare)), seen, starts.length);
console.log(show(search(nodes, 100, node => node.pos, (a, b) => a - b)));
