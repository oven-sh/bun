let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_86 = 0, i2_37 = 0;
  L0_27: for (let i0_5 = 0; i0_5 < 3 && i0_5 < 3; i0_5++) {
    a >>>= 0;
  }
  L0_5: for (let i0_28 = 0; i0_28 < n && i0_28 < 3; i0_28++) {
    if (m0 === m1) break L0_5;
    e -= 1;
    a = (i0_28 * p);
    i1_86 = 0;
    L1_62: while (i1_86++ < 4) {
      i2_37 = 0;
      L2_55: while (i2_37++ < 4) {
        a = m1;
        m1 = a;
      }
      L2_11: for (let i3_28 = 0; i3_28 < p && i3_28 < 2; i3_28++) {
        L3_70: for (let i4_3 = 3; i4_3 > 0; i4_3--) {
          if (i2_37 > q) b = (p - 1); else a = -1;
        }
        e--;
        if (q > p) d = (c >>> 3); else b = m0;
        if (p >= 1) d = i2_37; else d = i1_86;
      }
      d = 65536;
      m0 >>>= 0;
    }
  }
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
