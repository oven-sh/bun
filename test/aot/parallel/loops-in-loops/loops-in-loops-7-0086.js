let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_98 = 0, i4_79 = 0, i2_3 = 0, i4_13 = 0;
  L0_40: for (let i0_18 = 0; i0_18 < p && i0_18 < 3; i0_18++) {
    L1_52: for (let i1_43 = 0; i1_43 < 2 && i1_43 < 2; i1_43++) {
      L2_79: for (let i2_45 = 0; i2_45 < n && i2_45 < 3; i2_45++) {
        if (i2_45 <= e) break;
        if (b === i0_18) continue L1_52;
      }
      i2_98 = 0;
      L2_75: do {
        if (d != 100) b = 3; else a = 255;
        L3_12: for (let i3_51 = 3; i3_51 > 0; i3_51--) {
          m0 |= 0;
          if (i2_98 < b) continue;
          m0 |= 0;
          i4_79 = 0;
          L4_38: while (i4_79++ < 2) {
            b = (p >> m0);
          }
        }
        if (m1 >= m1) break L2_75;
      } while (++i2_98 < 3);
    }
    if (p > m1) break L0_40;
  }
  i2_3 = 0;
  L0_78: do {
    if (i2_98 < q) e = -1; else d = e;
    e += 2;
    m1 = -1;
    L1_68: for (let i3_80 = 0; i3_80 < n && i3_80 < 1; i3_80++) {
      L2_88: for (let i4_20 = 0; i4_20 < 3 && i4_20 < 3; i4_20++) {
        m0 = (e * i2_3);
        d = m1;
      }
      i4_13 = 0;
      L2_18: while (i4_13++ < 4) {
        L3_55: for (let i5_19 = 0; i5_19 < p && i5_19 < 2; i5_19++) {
          L4_54: for (let i6_49 = 1; i6_49 > 0; i6_49--) {
            if (i4_13 < c) break L1_68;
            a = i2_98;
          }
          b = d;
          if (i5_19 >= m0) break L3_55;
          d += 2;
        }
      }
      d++;
    }
  } while (++i2_3 < 3);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
