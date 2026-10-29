// `while (b)` over numbers: integers, what leaves the integers on the way (fractions, NaN, infinities, negative zero, past int32 and past 2 ** 53), and remainders by what the loop has tested.
function greatestCommonDivisor(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
function divisorOfSmall(i: number): number {
  let a = (i & 1023) + 1;
  let b = 360;
  while (b) [a, b] = [b, a % b];
  return a;
}
function halves(n: number): number {
  let steps = 0;
  while (n) {
    n = n / 2;
    steps++;
  }
  return steps;
}
function shifts(n: number): number {
  let steps = 0;
  while (n) {
    n = n >>> 1;
    steps++;
  }
  return steps;
}
function remainderByZero(n: number): string {
  let steps = 0;
  while (n) {
    n = n % 0;
    steps++;
  }
  return steps + " " + n;
}
function products(factor: number): string {
  let x = 1;
  let steps = 0;
  while (x) {
    x = x * factor;
    if (++steps > 40) break;
  }
  return steps + " " + x;
}
function downToNegativeZero(n: number): string {
  let steps = 0;
  while (n) {
    n = n * -0.5 - (n % 1);
    if (++steps > 2000) break;
  }
  return steps + " " + Object.is(n, -0) + " " + Object.is(n, 0);
}
function remaindersOfNegatives(a: number, b: number): string {
  const seen: number[] = [];
  while (b) {
    seen.push(a % b);
    [a, b] = [b, a % b];
  }
  return seen.map(x => (Object.is(x, -0) ? "-0" : String(x))).join(",");
}
const numbers = [0, -0, 1, 2, 7, 360, 1024, -12, 2147483647, -2147483648, 4294967296, 9007199254740993, 0.5, 1.5, -2.25, NaN, Infinity, -Infinity];
for (const a of numbers) {
  console.log(a, halves(Number.isFinite(a) ? a : 1), shifts(a), remainderByZero(a), products(a), downToNegativeZero(Number.isFinite(a) ? a : 3));
  for (const b of numbers) console.log(greatestCommonDivisor(a, b), remaindersOfNegatives(a, b));
}
let sum = 0;
for (let i = 0; i < 5000; i++) sum += divisorOfSmall(i);
console.log(sum);
