// marks[k] = (marks[k] + i) & 1023 inside a loop over i: the truncated sum is stored, returned or compared, and never feeds the next iteration.
// STATISTIC: ExactIntegersBehindNumbers <= 0
function addToEach(marks, first, turns) {
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < marks.length; k++) marks[k] = (marks[k] + i) & 1023;
  }
  return marks[turns & 7];
}
function subtractFromEach(marks, first, turns) {
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < marks.length; k++) marks[k] = (marks[k] - i) | 0;
  }
  return marks[turns & 7];
}
function invertEach(marks, first, turns) {
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < marks.length; k++) marks[k] = ~(marks[k] + i);
  }
  return marks[turns & 7];
}
function intoInt32Array(marks, out, first, turns) {
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < marks.length; k++) out[k] = marks[k] + i;
  }
  return out[turns & 7];
}
function firstLargeSum(marks, limit) {
  for (let k = 0; k < marks.length; k++) {
    const low = (marks[k] + k) | 0;
    if (low >= limit) return low;
  }
  return -1;
}
const wholeNumbers = () => Array.from({ length: 64 }, (_, k) => k);
const out = new Int32Array(64);
console.log(addToEach(wholeNumbers(), 0, 2000), subtractFromEach(wholeNumbers(), 0, 2000), invertEach(wholeNumbers(), 0, 2000));
console.log(intoInt32Array(wholeNumbers(), out, 0, 2000), out.join());
console.log(firstLargeSum(wholeNumbers(), 100), firstLargeSum(wholeNumbers(), 1000));

const odd = [0.5, -0.5, -0, 2147483647, -2147483648, 2147483648.5, 4294967295, 4294967296, 9007199254740991, -9007199254740991, 1e21, -1e21, NaN, Infinity, -Infinity, 1.7976931348623157e308, 5e-324];
for (const step of [addToEach, subtractFromEach, invertEach]) {
  for (const first of [0, 1, -3, 2147483645, -2147483648]) {
    for (const turns of [1, 2, 3]) {
      const marks = odd.slice();
      console.log(step.name, first, turns, step(marks, first, turns), marks.join());
    }
  }
}
for (const first of [0, 1, -1, 2147483646, -2147483648]) console.log(intoInt32Array(odd, out, first, 1), out.slice(0, odd.length).join());
for (const limit of [-2147483648, 0, 17, 2147483647]) console.log(firstLargeSum(odd, limit));
const holes = [1, , 3, , 5, 6, 7, 8];
console.log(addToEach(holes, 5, 1), holes.join(), firstLargeSum([, , 4], 1));
