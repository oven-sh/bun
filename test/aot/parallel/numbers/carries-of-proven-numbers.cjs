// The carry of a long multiplication is proven to be a number of any size: a digit, wider, negative, a fraction, NaN, -0.
class Long {
  constructor(length) {
    this.array = [];
    for (let i = 0; i < length; i++) this.array[i] = (i * 2654435761) & 0xfffffff;
  }
  am(i, x, w, j, c, n) {
    const a = this.array, b = w.array, xl = x & 0x3fff, xh = x >> 14;
    while (--n >= 0) {
      let l = a[i] & 0x3fff;
      const h = a[i++] >> 14, m = xh * l + h * xl;
      l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
      c = (l >> 28) + (m >> 14) + xh * h;
      b[j++] = l & 0xfffffff;
    }
    return c;
  }
  plain(i, x, w, j, c, n) {
    for (let k = 0; k < n; k++) {
      const l = this.array[i + k] + c;
      c = l >> 28;
      w.array[j + k] = l & 0xfffffff;
    }
    return c;
  }
}
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function run(c, x, n) {
  const a = new Long(12), b = new Long(14);
  const first = a.am(0, x, b, 1, c, n), second = a.plain(0, x, b, 0, c, n);
  return [show(first), show(second), b.array.map(show).join()].join(" ");
}
let total = 0;
for (let round = 0; round < 80; round++) total += run(round & 1 ? 0 : (round * 7919) & 0xfffffff, 12345678 + round, 11).length;
const carries = [0, 1, 268435455, 268435456, 1073741823, 1073741824, 2147483647, 2147483648, 4294967296, 9007199254740991, -1, -268435456, -2147483648, 0.5, 2.75, -0, NaN, Infinity, 1e300];
for (const c of carries) for (const x of [1, 268435455, 1073741823, -1]) for (const n of [0, 1, 5, 11]) console.log(show(c), x, n, run(c, x, n));
console.log(total);
