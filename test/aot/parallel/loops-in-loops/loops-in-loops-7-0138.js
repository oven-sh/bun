let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i4_73 = 0, i3_76 = 0;
  L0_9: for (let i0_2 = 0; i0_2 < 3 && i0_2 < 3; i0_2++) {
    if (i0_2 > 1) e = (q >> m1); else e = 3;
    L1_20: for (let i1_63 = 3; i1_63 > 0; i1_63--) {
      const t522 = (q * m1);
      d = i1_63;
      d = e;
    }
  }
  L0_58: for (let i0_32 = 0; i0_32 < n && i0_32 < 2; i0_32++) {
    L1_65: for (let i1_32 = 0; i1_32 < p && i1_32 < 3; i1_32++) {
      if (m1 !== a) break;
      m0 = b;
      m1 = q;
      if (d !== c) break;
    }
    L1_31: for (let i1_74 = 0; i1_74 < 3 && i1_74 < 3; i1_74++) {
      L2_72: for (let i2_56 = 0; i2_56 < 2 && i2_56 < 2; i2_56++) {
        L3_1: for (let i3_10 = 0; i3_10 < 4 && i3_10 < 4; i3_10++) {
          if (e > p) continue;
          i4_73 = 0;
          L4_6: while (i4_73++ < 4) {
            if (i4_73 === i4_73) c = (m0 ^ d); else b = (i3_10 % d);
            c = (m0 ^ c);
            c = null;
            b >>>= 0;
          }
          c = (i3_10 - a);
          L4_90: for (let i5_16 = 0; i5_16 < p && i5_16 < 3; i5_16++) {
            c = -0.5;
            e = (e % 1);
            if (m1 > d) continue L0_58;
          }
        }
        m0 = q;
      }
      i3_76 = 0;
      L2_5: do {
        if (e <= q) break;
        if (b !== i4_73) b = (m0 + d); else d = (q * m0);
      } while (++i3_76 < 4);
      if (d == 2) break;
    }
    m0 += 1;
    e = (d << m1);
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
