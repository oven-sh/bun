let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_28 = 0, i3_8 = 0, i5_43 = 0;
  L0_7: for (let i0_71 = 3; i0_71 > 0; i0_71--) {
    L1_71: for (let i1_13 = 0; i1_13 < 1 && i1_13 < 1; i1_13++) {
      a = 2147483647;
      a = 2147483648;
      L2_65: for (let i2_77 = 2; i2_77 > 0; i2_77--) {
        if (m0 != 100) b = (m0 & 3); else b = (i1_13 * b);
        c--;
        if (i1_13 <= i1_13) continue;
      }
    }
    L1_19: for (let i1_99 = 0; i1_99 < n && i1_99 < 3; i1_99++) {
      i2_28 = 0;
      L2_95: do {
        m0 = (q * i1_99);
        L3_43: for (let i3_51 = 0; i3_51 < n && i3_51 < 3; i3_51++) {
          c = i3_51;
          if (p < q) c = 7; else e = (q - i2_28);
          L4_10: for (let i4_13 = 0; i4_13 < 3 && i4_13 < 3; i4_13++) {
            b = (i1_99 & e);
            if (i3_51 != m0) a = p; else b = 1;
          }
        }
        a = (b & m1);
        i3_8 = 0;
        L3_33: do {
          e |= 0;
        } while (++i3_8 < 1);
      } while (++i2_28 < 1);
      L2_79: for (let i4_34 = 0; i4_34 < p && i4_34 < 2; i4_34++) {
        L3_33: for (let i5_20 = 0; i5_20 < 1 && i5_20 < 1; i5_20++) {
          if (i3_8 >= i4_34) continue;
          if (c === m0) a = (a + a); else e = true;
          if (d != d) d = (p << m1); else e = d;
        }
        i5_43 = 0;
        L3_25: do {
          L4_1: for (let i6_16 = 1; i6_16 > 0; i6_16--) {
            a--;
            if (m0 === 5) break;
            const t46 = 2;
          }
          a = i0_71;
          L4_41: for (let i6_70 = 0; i6_70 < n && i6_70 < 2; i6_70++) {
            a *= 2;
            d += 2;
          }
        } while (++i5_43 < 2);
      }
    }
    if (d >= 5) a = b; else b = 0;
    c += 2;
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
