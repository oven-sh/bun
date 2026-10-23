// "The result is computed from parameters i and j" says nothing about its kind: two int32 add, subtract, multiply, negate, shift and increment to numbers that are no int32. Each helper is called thousands of times with small integers, then at the edges. The answers are printed in full and used as numbers again.
function add(a: number, b: number): number {
  return a + b;
}
function subtract(a: number, b: number): number {
  return a - b;
}
function multiply(a: number, b: number): number {
  return a * b;
}
function negate(a: number): number {
  return -a;
}
function increment(a: number): number {
  return a + 1;
}
function decrement(a: number): number {
  return a - 1;
}
function double(a: number): number {
  return a + a;
}
function square(a: number): number {
  return a * a;
}
function shiftLeft(a: number, b: number): number {
  return a << b;
}
function shiftRightUnsigned(a: number, b: number): number {
  return a >>> b;
}
function absolute(a: number): number {
  return Math.abs(a);
}
function divide(a: number, b: number): number {
  return a / b;
}
function remainder(a: number, b: number): number {
  return a % b;
}
function power(a: number, b: number): number {
  return a ** b;
}
function sumOfThree(a: number, b: number, c: number): number {
  return add(add(a, b), c);
}
function addThenTruncate(a: number, b: number): number {
  return (a + b) | 0;
}
function multiplyThenTruncate(a: number, b: number): number {
  return (a * b) | 0;
}
function average(a: number, b: number): number {
  return (a + b) >> 1;
}
function count(from: number, steps: number): number {
  let n = from;
  for (let i = 0; i < steps; i++) n++;
  return n;
}
function countDown(from: number, steps: number): number {
  let n = from;
  for (let i = 0; i < steps; i++) n--;
  return n;
}
function sumList(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}
let warm = 0;
for (let i = 1; i < 3000; i++) {
  warm += add(i, 1) + subtract(i, 1) + multiply(i, 3) + negate(i) + increment(i) + decrement(i) + double(i) + square(i % 100) + shiftLeft(i, 2) + shiftRightUnsigned(i, 1) + absolute(-i);
  warm += divide(i * 2, 2) + remainder(i, 7) + power(i % 10, 2) + sumOfThree(i, i, i) + addThenTruncate(i, i) + multiplyThenTruncate(i, 2) + average(i, i) + count(i, 3) + countDown(i, 3) + sumList([i, i]);
}
console.log(warm);
const max = 2147483647;
const min = -2147483648;
console.log(add(max, 1), add(max, max), add(min, -1), add(min, min), add(max, min));
console.log(subtract(min, 1), subtract(max, -1), subtract(0, min), subtract(min, max));
console.log(multiply(max, 2), multiply(65536, 65536), multiply(min, -1), multiply(max, max), multiply(46341, 46341), multiply(-46341, 46341));
console.log(negate(min), negate(max), increment(max), decrement(min), double(max), double(min), square(65536), square(-65536), square(46340), square(46341));
console.log(shiftLeft(1, 31), shiftLeft(1, 32), shiftLeft(max, 1), shiftLeft(3, 30), shiftRightUnsigned(-1, 0), shiftRightUnsigned(min, 0), shiftRightUnsigned(-1, 1), shiftRightUnsigned(-1, 32), shiftRightUnsigned(-1, 31));
console.log(absolute(min), absolute(max), divide(min, -1), divide(7, 2), divide(1, 3), remainder(min, -1), power(2, 31), power(2, 32), power(-2, 31), power(2, -1), power(3, 40));
console.log(sumOfThree(max, 1, -1), sumOfThree(max, max, max), sumOfThree(min, min, 1));
console.log(addThenTruncate(max, 1), addThenTruncate(min, -1), multiplyThenTruncate(max, max), multiplyThenTruncate(65536, 65536), multiplyThenTruncate(123456789, 987654321), Math.imul(123456789, 987654321), average(max, max), average(max, 1));
console.log(count(max - 1, 3), countDown(min + 1, 3), sumList([max, max, max]), sumList([min, min]), sumList([max, 1, -1]));

// The answer goes on as an index, a length, a key, a bound of a loop.
const cells = [10, 20, 30];
function at(list: number[], i: number): number | undefined {
  return list[i];
}
console.log(at(cells, add(max, 1)), at(cells, add(max, min) + 2), at(cells, shiftRightUnsigned(-1, 0)), at(cells, multiply(65536, 65536)), at(cells, addThenTruncate(max, 2) - min));
const sparse: Record<number, string> = {};
sparse[add(max, 1)] = "past the largest";
sparse[shiftRightUnsigned(-1, 0)] = "the largest unsigned";
sparse[negate(min)] += " again";
console.log(JSON.stringify(sparse));
function loopsTo(limit: number): number {
  let rounds = 0;
  for (let i = limit - 2; i <= limit; i = increment(i)) {
    if (++rounds > 5) break;
  }
  return rounds;
}
console.log(loopsTo(10), loopsTo(max));

// The same helpers with an int32 and a number that is none, and what an int32 is compared with.
console.log(add(1, 0.5), add(max, 0.5), multiply(3, 0.5), subtract(1, 1e-9) < 1, add(2 ** 53, 1), add(2 ** 53, 2), add(1e308, 1e308), multiply(1e200, 1e200), subtract(-1e308, 1e308));
function isSmall(a: number, b: number): boolean {
  return add(a, b) < 10;
}
function isSame(a: number, b: number, c: number): boolean {
  return add(a, b) === c;
}
console.log(isSmall(max, 1), isSmall(max, max), isSmall(min, -1), isSame(max, 1, min), isSame(max, 1, 2147483648), isSame(min, -1, max));

// Callbacks: the accumulator of a reduce, the index of a map, the comparison of a sort.
console.log([max, 1].reduce(add), [max, max, max].reduce(add, 0), [min, -1].reduce(add), [65536, 65536, 65536].reduce(multiply, 1));
console.log([max, min, 0, -1, 1].sort(subtract).join(), [max, min, 0].map(increment).join(), [max, min].map(negate).join());
