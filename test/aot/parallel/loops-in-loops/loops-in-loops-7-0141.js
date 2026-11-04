let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_52 = 0, i1_65 = 0, i4_85 = 0, i5_71 = 0, i6_23 = 0;
  i0_52 = 0;
  L0_26: do {
    c = (m1 | d);
  } while (++i0_52 < 3);
  i1_65 = 0;
  L0_16: while (i1_65++ < 1) {
    L1_49: for (let i2_99 = 0; i2_99 < p && i2_99 < 3; i2_99++) {
      if (i0_52 <= a) break;
      c += 1;
      L2_74: for (let i3_72 = 0; i3_72 < 4 && i3_72 < 4; i3_72++) {
        a = q;
        i4_85 = 0;
        L3_76: do {
          if (b === b) break;
          L4_68: for (let i5_40 = 0; i5_40 < n && i5_40 < 1; i5_40++) {
            a = (m1 % d);
          }
          if (p !== 2) break;
        } while (++i4_85 < 3);
      }
      L2_28: for (let i4_22 = 0; i4_22 < p && i4_22 < 3; i4_22++) {
        i5_71 = 0;
        L3_23: do {
          a = c;
        } while (++i5_71 < 3);
        i6_23 = 0;
        L3_14: while (i6_23++ < 3) {
          if (a <= i1_65) b = 1; else e = -1;
          L4_77: for (let i7_6 = 0; i7_6 < 2 && i7_6 < 2; i7_6++) {
            a = q;
          }
          c++;
        }
        if (i4_85 == i4_22) continue L0_16;
      }
    }
    if (b == e) break L0_16;
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
