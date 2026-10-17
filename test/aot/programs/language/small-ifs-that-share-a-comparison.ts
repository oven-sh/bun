// Loops whose small `if`s hang on an element read in the same turn: several variables chosen by one comparison, a variable that is an operand of the comparison that changes it, counters stepped on either side of a test, and values chosen against zero.
function fill(length: number, seed: number): Int32Array {
  const values = new Int32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 22695477) + 1) >>> 0;
    values[i] = (state >>> 8) - (1 << 23);
  }
  return values;
}
function severalByOneTest(values: Int32Array): string {
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > 1000) {
      a = v;
      b = i;
      c++;
    }
  }
  return a + " " + b + " " + c;
}
function operandIsChanged(values: Int32Array): string {
  let greatest = -2147483648;
  let at = -1;
  let times = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > greatest) {
      greatest = v;
      at = i;
      times++;
    }
  }
  return greatest + " " + at + " " + times;
}
function counterIsAnOperand(values: Int32Array): string {
  let count = 0;
  let last = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! & 1023;
    if (v > count) {
      count++;
      last = v;
    }
  }
  return count + " " + last;
}
function stepsOnEitherSide(values: Int32Array): string {
  let whenTrue = 0;
  let whenFalse = 0;
  let run = 0;
  let gap = 0;
  let longestRun = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    whenTrue = v < 0 ? whenTrue + 1 : whenTrue;
    whenFalse = v < 0 ? whenFalse : whenFalse + 1;
    run = v < 0 ? run + 1 : 0;
    gap = v < 0 ? 0 : gap + 1;
    if (run > longestRun) longestRun = run;
  }
  return [whenTrue, whenFalse, run, gap, longestRun].join(" ");
}
function wrapsAround(values: Int32Array): string {
  let low = 2147483646 | 0;
  let other = 5;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    low = v < 0 ? (low + 1) | 0 : low;
    other = v > 0 ? (other + 1) | 0 : (low | 0);
  }
  return low + " " + other;
}
function byMask(values: Int32Array): string {
  let odd = 0;
  let lastOdd = 0;
  let third = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v & 1) {
      odd++;
      lastOdd = v;
    }
    if ((v & 12) === 0) third++;
  }
  return odd + " " + lastOdd + " " + third;
}
function samples(values: Float64Array, threshold: number): string {
  let above = 0;
  let last = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > threshold) {
      above++;
      last = i;
    }
  }
  return above + " " + last;
}
for (const [length, seed] of [[0, 1], [1, 2], [7, 3], [4096, 987654321], [70000, 42]] as const) {
  const values = fill(length, seed);
  console.log(length, "|", severalByOneTest(values), "|", operandIsChanged(values), "|", counterIsAnOperand(values), "|", stepsOnEitherSide(values), "|", wrapsAround(values), "|", byMask(values));
  const sorted = values.slice().sort();
  console.log(length, "sorted |", severalByOneTest(sorted), "|", operandIsChanged(sorted), "|", counterIsAnOperand(sorted), "|", stepsOnEitherSide(sorted), "|", wrapsAround(sorted), "|", byMask(sorted));
}
console.log(samples(new Float64Array([0.5, NaN, 2.5, -1, Infinity, 2.5]), 2.5), samples(new Float64Array([NaN, NaN]), NaN), samples(new Float64Array(0), 0));
