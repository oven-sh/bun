let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_21 = 0, i5_70 = 0, i5_39 = 0, i6_93 = 0, i6_26 = 0;
  i0_21 = 0;
  L0_30: do {
    const t371 = d;
    if (p <= b) c = (m1 >> d); else b = undefined;
    L1_91: for (let i1_50 = 2; i1_50 > 0; i1_50--) {
      L2_13: for (let i2_62 = 0; i2_62 < 4 && i2_62 < 4; i2_62++) {
        d = (m1 * i0_21);
      }
      m0 *= 2;
    }
    const t675 = -0.5;
  } while (++i0_21 < 2);
  L0_29: for (let i1_0 = 0; i1_0 < 4 && i1_0 < 4; i1_0++) {
    if (a !== m0) continue L0_29;
    L1_47: for (let i2_38 = 0; i2_38 < n && i2_38 < 4; i2_38++) {
      b = p;
      m0 -= 1;
      L2_6: for (let i3_82 = 0; i3_82 < n && i3_82 < 2; i3_82++) {
        if (i0_21 == 0) c = i3_82; else c = (i0_21 + i0_21);
        L3_17: for (let i4_99 = 4; i4_99 > 0; i4_99--) {
          i5_70 = 0;
          L4_58: do {
            b = (d ^ c);
            c = (d + m0);
            a = 0;
            d = (m1 & 1);
          } while (++i5_70 < 3);
        }
        i5_39 = 0;
        L3_81: do {
          i6_93 = 0;
          L4_39: while (i6_93++ < 3) {
            if (c != p) continue L0_29;
          }
          L4_29: for (let i7_85 = 0; i7_85 < n && i7_85 < 2; i7_85++) {
            a = (b % m1);
            if (m0 < e) continue L0_29;
            c = (d ^ i2_38);
          }
          L4_7: for (let i7_77 = 0; i7_77 < p && i7_77 < 2; i7_77++) {
            m0 = (i1_0 >> i5_39);
            c += 1;
            if (q < 100) b = null; else e = (i0_21 * a);
            e = (i6_93 - b);
          }
        } while (++i5_39 < 4);
      }
      i6_26 = 0;
      L2_64: while (i6_26++ < 1) {
        if (e >= e) b = (m1 + e); else e = (i5_70 % i2_38);
        e >>>= 0;
      }
    }
    m1 = i0_21;
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
