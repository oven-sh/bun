// Flags: --aot-check=verify-each-pass
function k0(x, y, z) {
  let a = x,
    b = y,
    c = z,
    d = 0,
    e = 7,
    f = 3;
  let i0 = 0;
  outer: while (i0 < 4) {
    i0++;
    for (let i1 = 0; i1 < (z & 7) + 1; i1++) {
      a += Math.imul(b, b) & 7;
      e ^= Math.abs(i1);
      e = i0 < a ? i0 : a;
      if (c <= e) continue outer;
    }
  }
  return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;
}
console.log(
  [
    k0(255, -65535, -65535),
    k0(65535, -2, 3),
    k0(-65535, 2147483646, 7),
    k0(2, -2147483648, 100),
    k0(32768, -65536, 8),
    k0(7, 12, 100),
    k0(4, 65536, 2147483647),
    k0(9, -1, -65535),
  ].join(" "),
);
