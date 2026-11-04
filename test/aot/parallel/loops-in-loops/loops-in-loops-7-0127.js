let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_92 = 0, i3_82 = 0, i3_47 = 0, i4_31 = 0;
  L0_59: for (let i0_34 = 0; i0_34 < n && i0_34 < 1; i0_34++) {
    i1_92 = 0;
    L1_92: while (i1_92++ < 2) {
      L2_76: for (let i2_37 = 0; i2_37 < p && i2_37 < 1; i2_37++) {
        i3_82 = 0;
        L3_17: while (i3_82++ < 4) {
          a = p;
          L4_39: for (let i4_44 = 0; i4_44 < n && i4_44 < 3; i4_44++) {
            d = c;
            m0 = (c - i2_37);
            if (d != i0_34) a = i0_34; else e = 2;
            c = (a >> 2);
          }
          m1 = c;
          a = a;
        }
        m0--;
      }
      L2_45: for (let i3_66 = 1; i3_66 > 0; i3_66--) {
        L3_69: for (let i4_16 = 0; i4_16 < n && i4_16 < 4; i4_16++) {
          L4_41: for (let i5_11 = 0; i5_11 < n && i5_11 < 1; i5_11++) {
            b += 2;
          }
          if (i3_66 < m0) continue L0_59;
          if (p != i3_82) continue;
          b = (i4_16 + e);
        }
      }
      if (q < a) break;
    }
    L1_73: for (let i3_33 = 0; i3_33 < 3 && i3_33 < 3; i3_33++) {
      L2_71: for (let i4_30 = 0; i4_30 < 4 && i4_30 < 4; i4_30++) {
        if (p < d) break L0_59;
        a = b;
      }
    }
    m0 = (i1_92 << i0_34);
  }
  L0_4: for (let i2_60 = 0; i2_60 < 4 && i2_60 < 4; i2_60++) {
    i3_47 = 0;
    L1_86: do {
      L2_54: for (let i4_81 = 0; i4_81 < p && i4_81 < 2; i4_81++) {
        if (a > a) continue L1_86;
        if (i2_60 != c) c = c; else e = q;
        m1 = (i1_92 | m0);
      }
      m1 = m1;
      i4_31 = 0;
      L2_39: while (i4_31++ < 1) {
        m0 = i4_31;
      }
      m0 += 2;
    } while (++i3_47 < 3);
    c = b;
    const t599 = (d - 3);
    a = m0;
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
