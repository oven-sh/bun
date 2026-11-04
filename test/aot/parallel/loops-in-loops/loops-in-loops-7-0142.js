let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_50 = 0, i4_61 = 0, i4_87 = 0, i4_84 = 0;
  i0_50 = 0;
  L0_94: do {
    const t204 = d;
  } while (++i0_50 < 1);
  L0_72: for (let i1_2 = 0; i1_2 < n && i1_2 < 2; i1_2++) {
    L1_2: for (let i2_15 = 0; i2_15 < n && i2_15 < 1; i2_15++) {
      L2_3: for (let i3_57 = 0; i3_57 < p && i3_57 < 1; i3_57++) {
        L3_1: for (let i4_19 = 0; i4_19 < p && i4_19 < 1; i4_19++) {
          if (m0 == i0_50) continue L1_2;
          m1 = p;
          if (i2_15 == 0) break;
          e = c;
        }
        i4_61 = 0;
        L3_46: do {
          if (a === i1_2) a = -1; else c = 2147483647;
          m1 = (i1_2 ^ 3);
          L4_72: for (let i5_67 = 0; i5_67 < n && i5_67 < 3; i5_67++) {
            d = (i3_57 + i1_2);
            d = (c - m1);
            const t873 = 0;
          }
          L4_29: for (let i5_32 = 0; i5_32 < 4 && i5_32 < 4; i5_32++) {
            a = 0.5;
            if (i2_15 == i5_32) break L2_3;
            d *= 2;
          }
        } while (++i4_61 < 4);
        c = (p * i2_15);
      }
    }
    L1_46: for (let i3_62 = 0; i3_62 < n && i3_62 < 3; i3_62++) {
      i4_87 = 0;
      L2_62: do {
        if (b <= m1) break L2_62;
        L3_55: for (let i5_5 = 0; i5_5 < n && i5_5 < 2; i5_5++) {
          L4_34: for (let i6_17 = 0; i6_17 < p && i6_17 < 3; i6_17++) {
            b = i5_5;
            m0 = true;
            a = (i1_2 >> i0_50);
          }
          b = -0.5;
          if (c <= i4_87) break L0_72;
        }
        L3_60: for (let i5_96 = 0; i5_96 < n && i5_96 < 1; i5_96++) {
          const t195 = i4_61;
          if (i3_62 >= 1) break L2_62;
        }
        L3_6: for (let i5_0 = 0; i5_0 < 3 && i5_0 < 3; i5_0++) {
          m1++;
          if (d != i5_0) continue;
        }
      } while (++i4_87 < 1);
      c = m1;
    }
    i4_84 = 0;
    L1_90: while (i4_84++ < 4) {
      L2_45: for (let i5_76 = 0; i5_76 < 2 && i5_76 < 2; i5_76++) {
        if (b < 2) a = e; else c = (i5_76 % 3);
        d |= 0;
        c = (e >> i1_2);
      }
      b = (i0_50 * 1);
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
