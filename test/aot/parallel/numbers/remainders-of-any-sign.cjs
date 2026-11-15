// Dividends and divisors of either sign, 0, -0, NaN, fractions, and integers around 2^30, 2^31 and 2^53, by variables in loops.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, -1, 2, -2, 3, 7, -7, 0.5, -0.5, 1073741823, 1073741824, -1073741824, 1073741825, 2147483646, 2147483647, -2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 9007199254740991, -9007199254740991, 9007199254740992, NaN, Infinity, -Infinity];
function table(list, divisor) {
  let line = "";
  for (let i = 0; i < list.length; i++) line += show(list[i] % divisor) + " ";
  return line;
}
function integers(from, to, divisor) {
  let zeros = 0,
    sum = 0;
  for (let i = from; i < to; i++) {
    const r = i % divisor;
    if (Object.is(r, -0)) zeros++;
    sum = sum * 0.5 + r;
  }
  return show(zeros) + " " + show(sum);
}
function steps(start, step, n) {
  let at = start,
    line = "";
  for (let i = 0; i < 6; i++) {
    at = (at + step) % n;
    line += show(at) + " ";
  }
  return line;
}
for (const divisor of values) console.log(table(values, divisor), integers(-9, 9, divisor), integers(2147483640, 2147483660, divisor));
for (const n of [1, 2, 5, -5, 0, 2147483647, 2147483648]) {
  for (const step of [1, -1, 3, 2147483647, -2147483648]) console.log(steps(0, step, n), steps(n - 1, step, n), steps(-2, step, n));
}
