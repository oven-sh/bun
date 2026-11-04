let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_1 = 0, i4_17 = 0, i4_38 = 0, i5_14 = 0;
  L0_25: for (let i0_39 = 0; i0_39 < 2 && i0_39 < 2; i0_39++) {
    L1_62: for (let i1_84 = 0; i1_84 < n && i1_84 < 4; i1_84++) {
      m0 = "x";
      i2_1 = 0;
      L2_68: do {
        b = (d & q);
        e = null;
        L3_26: for (let i3_56 = 0; i3_56 < 2 && i3_56 < 2; i3_56++) {
          L4_6: for (let i4_15 = 0; i4_15 < p && i4_15 < 2; i4_15++) {
            m0 = true;
            if (m0 === i1_84) e = (p * i1_84); else e = b;
            a = (d >> i3_56);
            const t453 = (q * b);
          }
          i4_17 = 0;
          L4_5: do {
            e = (m1 << e);
            c *= 2;
            if (d > i2_1) d = (i1_84 ^ e); else c = i3_56;
          } while (++i4_17 < 2);
          const t202 = 9007199254740991;
          c = (a - m1);
        }
      } while (++i2_1 < 1);
      b = (i4_17 << c);
    }
    c = i4_17;
    L1_25: for (let i3_11 = 0; i3_11 < n && i3_11 < 3; i3_11++) {
      d = q;
    }
  }
  L0_74: for (let i2_29 = 0; i2_29 < p && i2_29 < 3; i2_29++) {
    L1_24: for (let i3_44 = 2; i3_44 > 0; i3_44--) {
      c = 65536;
      m0 = 1;
      i4_38 = 0;
      L2_8: do {
        i5_14 = 0;
        L3_20: do {
          a = 1;
          m0 += 1;
          m1 *= 2;
          m0 = (i2_1 * i2_1);
        } while (++i5_14 < 4);
      } while (++i4_38 < 4);
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
