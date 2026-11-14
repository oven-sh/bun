// Digits that are multiplied in halves: inside their width one product takes the place of four. Outside of it each step rounds and wraps as written.
function multiplyAdd(a, i, x, b, j, c, n) {
  var xl = x & 0x3fff, xh = x >> 14;
  while (--n >= 0) {
    var l = a[i] & 0x3fff;
    var h = a[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return c;
}
function fifteenBits(a, x, b, c, n) {
  var xl = x & 0x7fff, xh = x >> 15, j = 0;
  for (var i = 0; i < n; i++) {
    var d = a[i], l = d & 0x7fff, h = d >> 15, m = h * xl + l * xh;
    l = ((m & 0x7fff) << 15) + b[j] + xl * l + c;
    c = xh * h + (m >> 15) + (l >> 30);
    b[j++] = l & 0x3fffffff;
  }
  return c;
}
function thirteenBits(a, x, b, n) {
  var c = 0, seen = 0, xl = x & 0x1fff, xh = x >> 13;
  for (var i = 0; i < n; i++) {
    var l = a[i] & 0x1fff, h = a[i] >> 13, m = xh * l + h * xl;
    l = xl * l + ((m & 0x1fff) << 13) + b[i] + c;
    c = (l >> 26) + (m >> 13) + xh * h;
    b[i] = l & 0x3ffffff;
    seen ^= l ^ m;
  }
  return [c, seen].join();
}
class Digits {
  constructor(digits) {
    this.digits = digits;
  }
  addProduct(x, to, n, c) {
    var a = this.digits, b = to.digits, xl = x & 0x3fff, xh = x >> 14, i = 0;
    while (--n >= 0) {
      var l = a[i] & 0x3fff, h = a[i] >> 14, m = xh * l + h * xl;
      l = xl * l + ((m & 0x3fff) << 14) + b[i] + c;
      c = (l >> 28) + (m >> 14) + xh * h;
      b[i++] = l & 0xfffffff;
    }
    return c;
  }
}
const is = v => (Array.isArray(v) ? "[" + Array.from(v, is).join() + "]" : Object.is(v, -0) ? "-0" : String(v));
const top = 0xfffffff;
const digits = () => [top, 12345678, 0, 1, top, 0x3fff, 0x4000, 200000000, 7, top, 99999999, 5];
const sums = () => [top, 0, top, 5, 123456789, 0, 0, top, 1, top, 0, 3];
const doors = [
  ["inside", (a, b) => {}, top, 0],
  ["doubled", (a, b) => {}, 2 * top, 0],
  ["four times", (a, b) => {}, 4 * top + 3, 5],
  ["widest", (a, b) => {}, 2147483647, 2147483647],
  ["negative factor", (a, b) => {}, -2147483648, 0],
  ["fractional factor", (a, b) => {}, 268435455.5, 0.25],
  ["carry of a digit", (a, b) => {}, 77, top],
  ["negative carry", (a, b) => {}, 77, -1],
  ["minus zero", (a, b) => {}, -0, -0],
  ["NaN", (a, b) => {}, NaN, NaN],
  ["nothing", (a, b) => {}, undefined, undefined],
  ["wide digit", (a, b) => { a[5] = 0x10000000; }, top, 0],
  ["wider digit", (a, b) => { a[5] = 2147483647; }, top, 0],
  ["unsigned digit", (a, b) => { a[5] = 4294967295; }, top, 0],
  ["negative digit", (a, b) => { a[7] = -3; }, 2 * top, 0],
  ["fractional digit", (a, b) => { a[7] = 1.75; }, top, 0],
  ["hole among digits", (a, b) => { delete a[3]; }, top, 0],
  ["text among digits", (a, b) => { a[3] = "17"; }, top, 0],
  ["wide sum", (a, b) => { b[6] = 0x10000000; }, top, 0],
  ["negative sum", (a, b) => { b[6] = -1; }, top, 0],
  ["fractional sum", (a, b) => { b[6] = 0.5; }, top, 0],
  ["hole among sums", (a, b) => { delete b[6]; }, top, 0],
  ["text among sums", (a, b) => { b[6] = "3"; }, top, 0],
  ["short sums", (a, b) => { b.length = 4; }, top, 0],
  ["frozen sums", (a, b) => { Object.freeze(b); }, top, 0],
  ["huge sum", (a, b) => { b[2] = 2 ** 53; }, top, 0],
];
function run(change, x, c, how) {
  const a = digits(), b = sums();
  change(a, b);
  let said;
  try {
    said = how === 0 ? multiplyAdd(a, 0, x, b, 0, c, 12) : how === 1 ? fifteenBits(a, x, b, c, 12) : how === 2 ? thirteenBits(a, x, b, 12) : new Digits(a).addProduct(x, new Digits(b), 12, c);
  } catch (e) {
    said = e.constructor.name;
  }
  return is(said) + " " + is(b);
}
for (let round = 0; round < 60; round++) for (let how = 0; how < 4; how++) run(doors[round % 7][1], (round * 7654321) & top, round & 1, how);
for (const [name, change, x, c] of doors) for (let how = 0; how < 4; how++) console.log(name, how, run(change, x, c, how));
const aliased = digits();
console.log(multiplyAdd(aliased, 0, top, aliased, 0, 0, 12), is(aliased));
console.log(multiplyAdd(aliased, 0, 12345, aliased, 2, 1, 10), is(aliased));
const view = new Int32Array(sums()), from = new Float64Array(digits());
console.log(multiplyAdd(from, 0, top, view, 0, 0, 12), is(Array.from(view)));
