let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_8 = 0;
  L0_30: for (let i0_59 = 0; i0_59 < n && i0_59 < 2; i0_59++) {
    L1_80: for (let i1_48 = 0; i1_48 < n && i1_48 < 4; i1_48++) {
      if (d != e) c = null; else e = (d << i1_48);
      if (d > d) break L1_80;
      L2_49: for (let i2_97 = 1; i2_97 > 0; i2_97--) {
        d--;
        const t794 = (d ^ p);
      }
      i2_8 = 0;
      L2_71: while (i2_8++ < 3) {
        m0 = d;
        m1 = (i0_59 & i1_48);
        L3_99: for (let i3_59 = 0; i3_59 < 2 && i3_59 < 2; i3_59++) {
          m1 *= 2;
        }
      }
    }
    L1_84: for (let i2_3 = 0; i2_3 < n && i2_3 < 3; i2_3++) {
      L2_23: for (let i3_12 = 0; i3_12 < n && i3_12 < 3; i3_12++) {
        const t41 = 2147483648;
        b = (i2_8 * b);
      }
      if (p > i2_3) continue L1_84;
      L2_87: for (let i3_85 = 0; i3_85 < 4 && i3_85 < 4; i3_85++) {
        L3_83: for (let i4_99 = 0; i4_99 < p && i4_99 < 3; i4_99++) {
          L4_14: for (let i5_87 = 0; i5_87 < 1 && i5_87 < 1; i5_87++) {
            a = 9007199254740991;
            m0 -= 1;
            a = i2_8;
          }
        }
      }
    }
  }
  L0_43: for (let i1_56 = 4; i1_56 > 0; i1_56--) {
    if (q >= 2) e = (m0 * 2); else b = m1;
    e = q;
    c = a;
    c = 3;
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
