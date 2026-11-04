let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_93 = 0, i3_58 = 0;
  L0_10: for (let i0_7 = 0; i0_7 < n && i0_7 < 3; i0_7++) {
    a = (c & 3);
  }
  i0_93 = 0;
  L0_42: while (i0_93++ < 3) {
    e = (a << 3);
    m0 = 7;
    const t234 = b;
    L1_8: for (let i1_12 = 0; i1_12 < 4 && i1_12 < 4; i1_12++) {
      L2_79: for (let i2_29 = 1; i2_29 > 0; i2_29--) {
        if (c < i1_12) break L0_42;
        i3_58 = 0;
        L3_30: while (i3_58++ < 3) {
          if (i0_93 < a) b = (i3_58 | m0); else b = (m0 >>> i1_12);
          L4_39: for (let i4_26 = 0; i4_26 < 3 && i4_26 < 3; i4_26++) {
            m1 = m1;
          }
          const t981 = (i1_12 & m1);
          if (e < m1) a = i0_93; else e = c;
        }
        L3_59: for (let i4_31 = 0; i4_31 < n && i4_31 < 1; i4_31++) {
          L4_66: for (let i5_91 = 3; i5_91 > 0; i5_91--) {
            if (m1 <= d) a = (i2_29 >> c); else c = (d << q);
            d |= 0;
            c = 0.5;
            c = "x";
          }
        }
        L3_81: for (let i4_11 = 0; i4_11 < 3 && i4_11 < 3; i4_11++) {
          m0 = undefined;
          if (q !== q) break;
        }
      }
      m0 = q;
      c = (m0 * b);
      const t323 = m0;
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
