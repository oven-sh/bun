// The carry of a long multiplication comes from outside: a digit, more than one, negative, a fraction, nothing, an object that counts its conversions.
function addProduct(a, x, b, c, n, j) {
  var xl = x & 0x3fff, xh = x >> 14, i = 0;
  while (--n >= 0) {
    var l = a[i] & 0x3fff, h = a[i++] >> 14, m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return c;
}
function countDown(list, n) {
  let s = 0;
  while (--n >= 0) s = (s * 31 + list[n]) | 0;
  return [s, n].join();
}
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
const digits = () => [268435455, 1, 16384, 16383, 0, 200000000, 77, 268435454];
let conversions = 0;
const counting = { valueOf() { conversions++; return 3; } };
const carries = [0, 1, 268435455, 268435456, 536870912, 1073741823, 1073741824, 2147483647, 2147483648, 4294967295, -1, -268435456, -2147483648, 0.5, -0, NaN, Infinity, undefined, null, "5", true, counting, 10n];
const factors = [1, 268435455, 536870910, 1073741823, -1, 16383];
for (let round = 0; round < 80; round++) addProduct(digits(), factors[round % 4], digits(), round & 3, 8, 0);
for (const c of carries) {
  for (const x of factors) {
    const b = digits();
    let said;
    try {
      said = show(addProduct(digits(), x, b, c, 8, 0));
    } catch (e) {
      said = e.constructor.name;
    }
    console.log(show(typeof c === "object" && c ? "counting" : c), x, said, b.map(show).join());
  }
}
console.log(conversions);
for (let round = 0; round < 60; round++) countDown(digits(), 8);
for (const n of [8, 0, -1, -2147483648, 2147483648, 3.5, "6", null, undefined, NaN, true, { valueOf: () => 4 }]) console.log(show(typeof n === "object" && n ? "four" : n), countDown(digits(), n === 2147483648 ? 9 : n));
