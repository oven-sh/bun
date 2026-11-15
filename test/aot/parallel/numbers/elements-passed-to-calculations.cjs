// STATISTIC: PassedHolesLeaveIterations >= 5
// Elements that a loop passes to a function that only calculates with them: a hole leaves the iteration, and the generic version goes on.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function bezier(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function curve(points, steps) {
  let s = 0;
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    s += bezier(points[i & 3], points[(i + 1) & 3], points[(i + 2) & 3], points[(i + 3) & 3], steps[i]);
    out.push(s);
  }
  return out;
}
function map(x, a, b, c, d) {
  return c + ((x - a) * (d - c)) / (b - a + 0.25);
}
function ranges(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += map(v[i & 7], v[(i + 3) & 7], v[(i + 6) & 7], v[(i + 9) & 7], v[(i + 12) & 7]);
  return s;
}
const lists = [
  [0.5, 1, 2.25, 3, -1.5, 0.125, 7, 4],
  [1, 2, 3, 4, 5, 6, 7, 8],
  [0.5, , 2.25, 3, -1.5, 0.125, 7, 4],
  [1, 2, , 4, 5, 6, 7, 8],
  [0.5, 1.5, 2.5],
  ["1", 2, 3, 4, 5, 6, 7, 8],
  [null, undefined, true, "x", {}, [], 1.5, -0],
  [NaN, 1, 2, 3, 4, 5, 6, 7],
  [],
  [2147483647, 2147483648, -2147483648, 4294967295, 9007199254740991, 5e-324, -0, Infinity],
];
for (const l of lists) {
  console.log(curve(l, l).map(show).join(" "));
  for (const n of [0, 1, 5, 20]) console.log(show(ranges(l, n)));
}
// A hole that Array.prototype answers is refused; a hole that is filled while the loop runs is not.
function filling(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += map(v[i & 3], v[(i + 1) & 3], v[(i + 2) & 3], v[(i + 3) & 3], v[i & 3]);
    if (i === 3) v[1] = 2.5;
  }
  return s;
}
console.log(show(filling([1.5, , 2.5, 3.5], 12)), show(filling([1.5, 2, 2.5, 3.5], 12)));
// A callee that tells undefined from NaN.
function told(a, b, c, d, e) {
  return a === undefined ? 1000 : a * b * c + d * e * a - b * c * d + e * e * a;
}
function tell(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += told(v[i & 7], v[(i + 1) & 7], v[(i + 2) & 7], v[(i + 3) & 7], v[(i + 4) & 7]);
  return s;
}
for (const l of lists) console.log(show(tell(l, 9)));
