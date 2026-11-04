let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_34 = 0, i3_2 = 0, i5_45 = 0, i6_43 = 0;
  L0_53: for (let i0_65 = 3; i0_65 > 0; i0_65--) {
    b = (b | d);
    L1_74: for (let i1_34 = 0; i1_34 < p && i1_34 < 4; i1_34++) {
      m0++;
      m1 = (b >> 3);
      i2_34 = 0;
      L2_65: do {
        i3_2 = 0;
        L3_3: do {
          m0 = 2;
          c += 2;
          if (c > e) b = q; else a = i3_2;
          if (b != 0) continue L0_53;
        } while (++i3_2 < 1);
        L3_54: for (let i4_30 = 0; i4_30 < 2 && i4_30 < 2; i4_30++) {
          i5_45 = 0;
          L4_30: do {
            d++;
            m0 = (i2_34 + 2);
            a = true;
            c = i0_65;
          } while (++i5_45 < 1);
          i6_43 = 0;
          L4_83: do {
            m1 = (e | i0_65);
            c--;
            const t439 = (b % q);
          } while (++i6_43 < 1);
        }
        m1 = (p * b);
      } while (++i2_34 < 2);
      a = b;
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
