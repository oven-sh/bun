// STATISTIC: CallsInlined >= 4
// A function without parameters that steps numbers in variables is copied into the loops that call it: random numbers.
let s = 7;
function mulberry() {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let seed = 49734321;
function octane() {
  seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff;
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
  seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff;
  seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
  seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff;
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
  return (seed & 0xfffffff) / 0x10000000;
}
let x = 123456789, y = 362436069, z = 521288629, w = 88675123;
function xorshift() {
  const t = x ^ (x << 11);
  x = y;
  y = z;
  z = w;
  w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8));
  return (w >>> 0) / 4294967296;
}
let product = 1;
function grows() {
  product = product * 1.5 + 0.25;
  product = product > 1e300 ? product / 1e300 : product - Math.floor(product / 1000) * 1000;
  return product;
}
function sums(turns) {
  let a = 0, b = 0, c = 0, d = 0;
  for (let k = 0; k < turns; k++) {
    a += mulberry();
    b = b * 0.5 + octane();
    if (k & 1) c += xorshift();
    d -= grows();
  }
  console.log(a, b, c, d, s, seed, w, product);
}
sums(0);
sums(1);
sums(100);
s = 0.5;
seed = -0;
w = NaN;
product = Infinity;
sums(10);
s = 2 ** 40;
seed = 2147483648;
w = -1;
product = -0;
sums(1000);
