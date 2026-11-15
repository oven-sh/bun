// STATISTIC: InvariantPathsOfDoubles >= 3
// Sums and products of parameters that a loop does not change, taken beside a double: they are calculated before the loop and not in each iteration.
let calls = 0;
const show = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
const A = (a1, a2) => 1.0 - 3.0 * a2 + 3.0 * a1;
const B = (a1, a2) => 3.0 * a2 - 6.0 * a1;
const C = a1 => 3.0 * a1;
const calculate = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const slope = (t, a1, a2) => 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
function newton(x, guess, x1, x2) {
  for (let i = 0; i < 4; ++i) {
    const s = slope(guess, x1, x2);
    if (s === 0.0) return guess;
    guess -= (calculate(guess, x1, x2) - x) / s;
  }
  return guess;
}
// The program cannot tell who makes curves: the control points are captured values of any kind.
module.exports = function curve(x1, y1, x2, y2) {
  return function (x) {
    if (x === 0 || x === 1) return x;
    return calculate(newton(x, x, x1, x2), y1, y2);
  };
};
function along(x1, y1, x2, y2) {
  const ease = module.exports(x1, y1, x2, y2);
  let s = 0;
  for (let i = 0; i < 9; i++) s = s * 0.5 + ease(i / 8);
  return s;
}
function steps(n, scale, shift) {
  let s = 0.5;
  for (let i = 0; i < n; i++) s = s * 0.5 + (scale * 3 - shift * 2) * s + (shift + scale) / 4;
  return s;
}
function keys(v, width, height) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += v[width * 2 - height + i] + (width * height - i) * 0.5;
  return s;
}
function whole(n, a, b) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + (a * 7 - b * 3) * i) | 0;
  return s;
}
const counted = { valueOf() { calls++; return 2.5; } };
const numbers = [0, 1, -0, 0.25, 0.42, 2, 3, NaN, Infinity, 2147483647, -2147483648, 2147483648, 9007199254740991, 1e300, 5e-324];
const others = ["3", "x", undefined, null, true, counted, 3n, {}, [5]];
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return e.constructor.name;
  }
}
const list = Array.from({ length: 32 }, (_, k) => k * 1.5);
for (const a of numbers.concat(others)) {
  for (const b of a === undefined || typeof a !== "number" ? numbers.slice(0, 7) : numbers.slice(0, 9).concat(others)) {
    console.log(attempt(() => along(a, b, b, a)), attempt(() => along(a, 0.1, 0.25, b)), attempt(() => steps(5, a, b)), attempt(() => keys(list, a, b)), attempt(() => whole(6, a, b)), calls);
  }
}
