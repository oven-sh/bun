let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_1 = 0, i2_63 = 0, i3_77 = 0, i5_27 = 0;
  L0_39: for (let i0_4 = 0; i0_4 < 3 && i0_4 < 3; i0_4++) {
    i1_1 = 0;
    L1_86: do {
      e = (m1 >>> c);
    } while (++i1_1 < 3);
    i2_63 = 0;
    L1_40: while (i2_63++ < 3) {
      if (q != p) break;
      m0 |= 0;
      m0 = (i1_1 - i0_4);
      i3_77 = 0;
      L2_73: while (i3_77++ < 1) {
        L3_73: for (let i4_8 = 0; i4_8 < p && i4_8 < 2; i4_8++) {
          const t771 = 2147483648;
          m1 = 2;
          i5_27 = 0;
          L4_77: do {
            d = 65536;
            if (m0 > i2_63) break;
            e *= 2;
          } while (++i5_27 < 3);
          m0 -= 1;
        }
        m1 >>>= 0;
        if (m1 <= i3_77) break L0_39;
      }
    }
    a--;
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
