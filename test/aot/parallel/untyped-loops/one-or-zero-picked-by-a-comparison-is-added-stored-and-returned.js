function countAbove(list, limit) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] > limit ? 1 : 0)) | 0;
  return count;
}

function countNotAbove(list, limit) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] > limit ? 0 : 1)) | 0;
  return count;
}

function countAboveAmongNumbers(list, limit) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] > limit ? 1 : 0)) | 0;
  return count;
}

function countNotAboveAmongNumbers(list, limit) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] > limit ? 0 : 1)) | 0;
  return count;
}

function countTruthy(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] ? 1 : 0)) | 0;
  return count;
}

function countFalsy(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) count = (count + (list[i] ? 0 : 1)) | 0;
  return count;
}

function mark(out, list, limit) {
  for (let i = 0; i < list.length; i++) out[i] = list[i] > limit ? 1 : 0;
}

function bits(list, limit) {
  let word = 0;
  for (let i = 0; i < 32; i++) word |= (list[i] <= limit ? 1 : 0) << i;
  return word;
}

function both(a, b) {
  const above = a > b ? 1 : 0;
  const below = a > b ? 0 : 1;
  return above * 10 + below;
}

function oneIfEqual(a, b) {
  return a === b ? 1 : 0;
}

function zeroIfEqual(a, b) {
  return a === b ? 0 : 1;
}

function largeTally(list, limit, start) {
  let count = start;
  for (let i = 0; i < list.length; i++) count += list[i] > limit ? 1 : 0;
  return count;
}

class Counter {
  hits = 0;
  static total = [3, 9, 27].map(value => (value > 5 ? 1 : 0)).join("");
  add(value, limit) {
    this.hits += value > limit ? 1 : 0;
    return this;
  }
}

const integers = new Int32Array(100);
for (let i = 0; i < integers.length; i++) integers[i] = (Math.imul(i, 2654435761) >> 8) % 1000;
const numbers = [0.5, NaN, -0, 7.25, Infinity, -Infinity, 3, NaN, 2 ** 40, -1.5];
const mixed = [0, 1, "", "a", null, undefined, NaN, {}, [], 0n, 1n, false, true, -0];

console.log(countAbove(integers, 0), countNotAbove(integers, 0), countAbove(integers, -2000), countNotAbove(integers, 2000));
console.log(countAbove(new Int32Array(0), 0), countNotAbove(new Int32Array(0), 0));
console.log(countAboveAmongNumbers(numbers, 1), countNotAboveAmongNumbers(numbers, 1), countAboveAmongNumbers(numbers, NaN), countNotAboveAmongNumbers(numbers, NaN));
console.log(countTruthy(mixed), countFalsy(mixed));
const marks = new Uint8Array(integers.length);
mark(marks, integers, 100);
console.log(marks.join(""));
console.log(bits(integers, 0), bits(integers, 500), bits(integers, -1000));
console.log(both(1, 2), both(2, 1), both(2, 2), both(NaN, 1), both("b", "a"));
console.log(oneIfEqual(1, 1), oneIfEqual(1, "1"), oneIfEqual(NaN, NaN), oneIfEqual(0, -0), zeroIfEqual(1, 1), zeroIfEqual(NaN, NaN), zeroIfEqual("a", "a"));
console.log(largeTally(integers, 0, 2147483600), largeTally(integers, 0, 2 ** 53 - 10), largeTally(integers, 0, 0.5), largeTally(integers, 0, -2147483700));
const counter = new Counter();
for (let i = 0; i < integers.length; i++) counter.add(integers[i], 250);
console.log(counter.hits, Counter.total);

let topLevel = 0;
for (let i = 0; i < integers.length; i++) topLevel = (topLevel + (integers[i] < -250 ? 1 : 0)) | 0;
console.log(topLevel);
