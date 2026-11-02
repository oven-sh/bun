// `i % divisors[i & 3]` in a loop: once the counter is known to be an integer the divisor is tested for one too, and the remainder is taken of integers.
// Divisors that are no integers, zero, negative, NaN and the infinities take the other road and give what the language says.
const wholes = [3, 5, 7, 11];
const mixed: number[] = [3, 2.5, -7, 0, -0, NaN, Infinity, -Infinity, 1e10, 0.1, 2147483647, -2147483648];

function remaindersOfWholes(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + (i % wholes[i & 3]!)) | 0;
  return sum;
}

function remaindersOfAnything(n: number): string {
  let sum = 0;
  let notNumbers = 0;
  let negativeZeros = 0;
  for (let i = 0; i < n; i++) {
    const r = i % mixed[i % mixed.length]!;
    if (r !== r) notNumbers++;
    else if (r === 0 && 1 / r < 0) negativeZeros++;
    else sum += r;
  }
  return `${sum} ${notNumbers} ${negativeZeros}`;
}

function countingDown(n: number): string {
  let sum = 0;
  let negativeZeros = 0;
  for (let i = 0; i > -n; i--) {
    const r = i % wholes[-i & 3]!;
    if (r === 0 && 1 / r < 0) negativeZeros++;
    sum += r;
  }
  return `${sum} ${negativeZeros}`;
}

console.log(remaindersOfWholes(1000), remaindersOfWholes(0), remaindersOfWholes(1));
console.log(remaindersOfAnything(1000));
console.log(countingDown(1000));
wholes[2] = 2.5;
console.log(remaindersOfWholes(1000));
wholes[1] = 0;
console.log(remaindersOfWholes(1000));
