// A loop divides a number for as long as the division leaves no remainder. The numbers are small integers at first, and then everything else a number can be: beyond 32 bits, fractions, negative, both zeros, infinite, not a number.
function factors(n) {
  const found = [];
  for (let d = 2; d * d <= n; d++)
    while (n % d === 0) {
      n /= d;
      found.push(d);
    }
  if (n > 1) found.push(n);
  return found.join("*");
}
function halved(n, divisor) {
  let turns = 0;
  while (n % divisor === 0 && turns < 70) {
    n /= divisor;
    turns++;
  }
  return `${Object.is(n, -0) ? "-0" : n} after ${turns}`;
}
function collatz(n) {
  let steps = 0;
  while (n !== 1 && steps < 400) {
    n = n % 2 === 0 ? n / 2 : 3 * n + 1;
    steps++;
  }
  return `${n} after ${steps}`;
}
function sumOfDigits(n) {
  let sum = 0;
  while (n >= 1) {
    sum += n % 10;
    n = (n - (n % 10)) / 10;
  }
  return sum;
}
let sum = 0;
for (let i = 2; i < 3000; i++) sum += factors(i).length + halved(i, 2).length + collatz(i).length + sumOfDigits(i);
console.log(sum);
for (const n of [2 ** 31, 2 ** 31 - 1, 2 ** 32 * 3, 2 ** 40 * 15, 600851475143, 1000000000039, 7.5, 0.5, -12, 0, -0, -Infinity, NaN])
  console.log(n, factors(n), sumOfDigits(n));
for (const n of [2 ** 31, -(2 ** 31), 2 ** 52, 7.5, 6.25, -12, -8, 0, -0, 1e300, Infinity, NaN])
  for (const divisor of [2, -2, 2.5, 1, -1, 0, 0.5, 2 ** 31, NaN, Infinity]) console.log(n, divisor, halved(n, divisor));
for (const n of [27, 2 ** 31 - 1, 2 ** 33 + 1, 113383, 1.5, -5, 0]) console.log(n, collatz(n));
