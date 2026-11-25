let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_5 = 0, i1_99 = 0, i3_84 = 0, i5_63 = 0, i6_97 = 0, i7_72 = 0, i8_58 = 0, i9_33 = 0;
  i0_5 = 0;
  L0_24: do {
    m0 = (m0 & 1);
    if (p == d) continue L0_24;
    i1_99 = 0;
    L1_43: do {
      L2_87: for (let i2_30 = 1; i2_30 > 0; i2_30--) {
        L3_58: for (let i3_34 = 0; i3_34 < n && i3_34 < 3; i3_34++) {
          L4_69: for (let i4_23 = 0; i4_23 < 2 && i4_23 < 2; i4_23++) {
            e = i0_5;
            e = m1;
          }
          if (q !== m0) continue L0_24;
          d = (d >> q);
        }
        if (i2_30 == a) a = (i1_99 | e); else b = b;
      }
    } while (++i1_99 < 4);
    if (i1_99 <= m0) d = a; else c = "x";
  } while (++i0_5 < 3);
  L0_97: for (let i2_15 = 0; i2_15 < p && i2_15 < 4; i2_15++) {
    if (i1_99 > 2) c = c; else b = m1;
    i3_84 = 0;
    L1_80: while (i3_84++ < 3) {
      L2_72: for (let i4_37 = 0; i4_37 < p && i4_37 < 3; i4_37++) {
        if (a !== i3_84) c = (p >> 3); else d = 65536;
        L3_14: for (let i5_40 = 0; i5_40 < 4 && i5_40 < 4; i5_40++) {
          L4_90: for (let i6_86 = 0; i6_86 < 2 && i6_86 < 2; i6_86++) {
            if (i5_40 >= i5_40) d = 0; else b = (i0_5 + p);
            d = q;
          }
          L4_11: for (let i6_64 = 0; i6_64 < 3 && i6_64 < 3; i6_64++) {
            if (i2_15 !== i4_37) continue L3_14;
          }
        }
        m0++;
      }
      e |= 0;
      c = (b + b);
      L2_89: for (let i4_62 = 0; i4_62 < 3 && i4_62 < 3; i4_62++) {
        if (a == i3_84) continue L2_89;
        i5_63 = 0;
        L3_69: do {
          if (i1_99 <= 0) d = (a % d); else e = 0.5;
        } while (++i5_63 < 4);
        i6_97 = 0;
        L3_38: while (i6_97++ < 1) {
          if (i3_84 < q) break;
          d |= 0;
          m0 = (b % i5_63);
          b |= 0;
        }
        i7_72 = 0;
        L3_84: do {
          L4_93: for (let i8_81 = 0; i8_81 < p && i8_81 < 4; i8_81++) {
            e++;
            const t969 = (i5_63 * b);
            b = i0_5;
            b = (p | 2);
          }
          L4_75: for (let i8_78 = 0; i8_78 < 2 && i8_78 < 2; i8_78++) {
            if (i7_72 !== e) d = q; else c = (p + i3_84);
            a = (a * i7_72);
            a = c;
            b = (b << 1);
          }
          i8_58 = 0;
          L4_64: do {
            b = (a | b);
          } while (++i8_58 < 2);
          i9_33 = 0;
          L4_12: do {
            b = (i7_72 ^ 3);
            m0 = undefined;
            e = 2;
          } while (++i9_33 < 2);
        } while (++i7_72 < 1);
      }
    }
    if (i7_72 > i2_15) break L0_97;
    c = (i6_97 & d);
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
