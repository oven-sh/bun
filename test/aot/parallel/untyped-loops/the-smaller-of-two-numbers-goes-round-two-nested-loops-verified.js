// Flags: --aot-check=verify-each-pass
function k2(x, y, z) {
  let a = x,
    b = y,
    c = z,
    d = 3,
    e = 1,
    f = 5;
  for (let i0 = 1; i0 <= (z & 3) + 1; i0++) {
    c = e < f ? f : e;
    let i1 = 0;
    while (i1 < (y & 3) + 1) {
      i1++;
      e = d < 1 ? c : i0;
      a = e < a ? e : a;
      b += Math.max(c, i1) & b;
    }
  }
  return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;
}
console.log(
  [k2(2, -32769, 100), k2(6, 8, 256), k2(3, -2147483647, 4), k2(-2147483647, 0, -65536), k2(7, -65535, 2)].join(" "),
);
