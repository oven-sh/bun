function show(name: string, value: number) {
  console.log(name, Object.is(value, -0) ? "-0" : value.toPrecision(12));
}
function all(x: number, y: number) {
  show("sin", Math.sin(x));
  show("sinh", Math.sinh(x));
  show("cos", Math.cos(x));
  show("cosh", Math.cosh(x));
  show("tan", Math.tan(x));
  show("tanh", Math.tanh(x));
  show("asin", Math.asin(x / 8));
  show("asinh", Math.asinh(x));
  show("acos", Math.acos(x / 8));
  show("acosh", Math.acosh(x + 8));
  show("atan", Math.atan(x));
  show("atanh", Math.atanh(x / 8));
  show("atan2", Math.atan2(y, x));
  show("exp", Math.exp(x));
  show("expm1", Math.expm1(x));
  show("log", Math.log(x + 8));
  show("log1p", Math.log1p(x + 8));
  show("log2", Math.log2(x + 8));
  show("log10", Math.log10(x + 8));
  show("cbrt", Math.cbrt(x));
  show("hypot of two", Math.hypot(x, y));
  show("hypot of three", Math.hypot(x, y, x + y));
  show("hypot of four", Math.hypot(x, y, x + y, x - y));
}
const pairs: [number, number][] = [[0, 0], [-0, 0], [0, -0], [1, 2], [-3.5, 0.25], [7, -7], [NaN, 1], [1, Infinity], [-Infinity, -Infinity]];
for (const [x, y] of pairs) {
  console.log("of", Object.is(x, -0) ? "-0" : x, Object.is(y, -0) ? "-0" : y);
  all(x, y);
}
