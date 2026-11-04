let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i3_53 = 0, i4_60 = 0;
  L0_44: for (let i0_64 = 2; i0_64 > 0; i0_64--) {
    L1_24: for (let i1_42 = 3; i1_42 > 0; i1_42--) {
      m0 = a;
      e |= 0;
      if (a == p) a = d; else d = NaN;
    }
    e = (m0 % q);
    m0 = (b % d);
    m0 = 0.5;
  }
  L0_12: for (let i0_22 = 0; i0_22 < n && i0_22 < 2; i0_22++) {
    L1_1: for (let i1_83 = 0; i1_83 < n && i1_83 < 3; i1_83++) {
      L2_53: for (let i2_23 = 0; i2_23 < 1 && i2_23 < 1; i2_23++) {
        if (m1 < 5) break L0_12;
        i3_53 = 0;
        L3_73: do {
          d = NaN;
        } while (++i3_53 < 3);
        i4_60 = 0;
        L3_98: while (i4_60++ < 3) {
          d = c;
        }
        if (i1_83 < a) break;
      }
      L2_27: for (let i4_11 = 0; i4_11 < n && i4_11 < 1; i4_11++) {
        e = m1;
      }
      L2_46: for (let i4_6 = 2; i4_6 > 0; i4_6--) {
        e = (m0 >>> i4_60);
      }
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
