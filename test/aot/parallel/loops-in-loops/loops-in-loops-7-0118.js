let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_30 = 0, i2_46 = 0, i3_57 = 0, i4_65 = 0, i5_22 = 0, i5_39 = 0;
  i0_30 = 0;
  L0_85: do {
    L1_56: for (let i1_60 = 0; i1_60 < 3 && i1_60 < 3; i1_60++) {
      i2_46 = 0;
      L2_14: while (i2_46++ < 3) {
        L3_54: for (let i3_7 = 0; i3_7 < p && i3_7 < 2; i3_7++) {
          if (i2_46 > d) break;
          b--;
          if (i2_46 !== i1_60) continue L0_85;
          m1 += 1;
        }
        L3_42: for (let i3_66 = 0; i3_66 < p && i3_66 < 1; i3_66++) {
          d = (m1 * m1);
        }
        i3_57 = 0;
        L3_15: while (i3_57++ < 3) {
          c = 2;
          i4_65 = 0;
          L4_34: while (i4_65++ < 3) {
            m0 += 1;
            m0 = 2147483648;
            b = 3;
          }
        }
        i5_22 = 0;
        L3_50: do {
          L4_99: for (let i6_19 = 0; i6_19 < n && i6_19 < 3; i6_19++) {
            e = i1_60;
            c += 1;
            c = (i1_60 >>> e);
          }
          c = (e << a);
          if (m0 == i0_30) break;
          L4_27: for (let i6_11 = 0; i6_11 < p && i6_11 < 1; i6_11++) {
            b += 2;
            c = (d + 3);
            b = -0;
            m0 = null;
          }
        } while (++i5_22 < 3);
      }
      d = (i2_46 ^ b);
    }
    i5_39 = 0;
    L1_32: do {
      L2_38: for (let i6_70 = 1; i6_70 > 0; i6_70--) {
        L3_82: for (let i7_77 = 0; i7_77 < n && i7_77 < 3; i7_77++) {
          if (i3_57 < c) continue L2_38;
          if (m0 !== i4_65) break L1_32;
          L4_66: for (let i8_84 = 0; i8_84 < 4 && i8_84 < 4; i8_84++) {
            if (a >= i6_70) continue L1_32;
          }
        }
        if (m1 != i0_30) break L1_32;
      }
      L2_83: for (let i6_2 = 0; i6_2 < 3 && i6_2 < 3; i6_2++) {
        L3_38: for (let i7_16 = 3; i7_16 > 0; i7_16--) {
          if (i0_30 == 5) b = 7; else c = m1;
        }
      }
      d = e;
    } while (++i5_39 < 1);
    e *= 2;
  } while (++i0_30 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
