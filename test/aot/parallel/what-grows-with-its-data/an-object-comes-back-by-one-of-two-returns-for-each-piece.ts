// Each piece of the data is looked at by a function that hands back an object by one of two returns, and by one that makes it on either side of a branch. The caller reads it and drops it.
// Sizes: 1000 4000 16000
// Passes: 40
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Digit = { found: boolean; value: number };
function digitAt(text: string, at: number): Digit {
  const code = text.charCodeAt(at);
  if (code < 48 || code > 57) return { found: false, value: 0 };
  return { found: true, value: code - 48 };
}
function inOrder(a: number, b: number): { low: number; high: number } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}
const text = "a1b22c333".repeat(size);
function once(): string {
  let sum = 0,
    widest = 0,
    before = 0;
  for (let at = 0; at < text.length; at++) {
    const digit = digitAt(text, at);
    if (!digit.found) continue;
    sum += digit.value;
    const pair = inOrder(before, digit.value + (at & 7));
    if (pair.high - pair.low > widest) widest = pair.high - pair.low;
    before = pair.high;
  }
  return sum + " " + widest + " " + before;
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
