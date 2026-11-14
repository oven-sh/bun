// Long multiplications whose digits are checked for holes and range at once: a hole, a digit that is too wide, negative or no int32 in each place of the unrolled iterations, and exits in the middle.
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
  return [c, i, j, n].join();
}
function multiplyUntil(a, i, x, b, j, c, n, last) {
  var xl = x & 0x3fff, xh = x >> 14, seen = -1;
  while (--n >= 0) {
    if (b[j] === last) break;
    var l = a[i] & 0x3fff;
    var h = a[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    seen = b[j];
    b[j++] = l & 0xfffffff;
  }
  return [c, i, j, n, seen].join();
}
const top = 0xfffffff;
const digits = () => [top, 12345678, 0, 1, top, 0x3fff, 0x4000, 200000000, 7, top, 99999999, 5, 3];
const sums = () => [top, 0, top, 5, 123456789, 0, 0, top, 1, top, 0, 3, 77];
const show = list => Array.from({ length: list.length }, (_, k) => (k in list ? String(Object.is(list[k], -0) ? "-0" : list[k]) : "hole")).join();
const odd = [
  (list, k) => { delete list[k]; },
  (list, k) => { list[k] = top + 1; },
  (list, k) => { list[k] = 2147483647; },
  (list, k) => { list[k] = -1; },
  (list, k) => { list[k] = -2147483648; },
  (list, k) => { list[k] = 0.5; },
  (list, k) => { list[k] = -0; },
  (list, k) => { list[k] = undefined; },
  (list, k) => { list[k] = "7"; },
  (list, k) => { list[k] = { valueOf() { return 9; } }; },
  (list, k) => { list.length = k; },
];
for (let round = 0; round < 60; round++) {
  multiplyAdd(digits(), round % 3, digits()[round % 13], sums(), round & 1, 0, 10);
  multiplyUntil(digits(), 0, 12345, sums(), 0, 0, 12, round % 4 ? -5 : 123456789);
}
for (const change of odd) {
  for (let k = 0; k < 12; k++) {
    for (const side of [0, 1, 2]) {
      const a = digits(), b = sums();
      if (side !== 1) change(a, k);
      if (side !== 0) change(b, k);
      let said;
      try {
        said = multiplyAdd(a, 0, 234567891, b, 0, 5, 12);
      } catch (e) {
        said = e.constructor.name;
      }
      const d = digits(), e = sums();
      if (side !== 1) change(d, k);
      if (side !== 0) change(e, k);
      let until;
      try {
        until = multiplyUntil(d, 0, 1234567, e, 0, 5, 12, k & 1 ? 1 : -7);
      } catch (error) {
        until = error.constructor.name;
      }
      console.log(k, side, said, show(b), until, show(e));
    }
  }
}
// The same array on both sides, one digit and several digits apart.
for (const apart of [0, 1, 2, 3, 4, 5]) {
  const both = digits().concat(sums());
  console.log(apart, multiplyAdd(both, 0, 87654321, both, apart, 0, 12), show(both));
}
