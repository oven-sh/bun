let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_43 = 0;
  L0_45: for (let i0_88 = 0; i0_88 < p && i0_88 < 3; i0_88++) {
    L1_13: for (let i1_43 = 0; i1_43 < n && i1_43 < 2; i1_43++) {
      L2_40: for (let i2_43 = 0; i2_43 < 3 && i2_43 < 3; i2_43++) {
        if (d !== m0) a = (q | e); else e = 9007199254740991;
        L3_55: for (let i3_20 = 0; i3_20 < 2 && i3_20 < 2; i3_20++) {
          e = 0;
        }
        m1 = (i2_43 - 1);
      }
      e = 1;
      i2_43 = 0;
      L2_79: do {
        L3_0: for (let i3_26 = 0; i3_26 < n && i3_26 < 2; i3_26++) {
          L4_75: for (let i4_12 = 0; i4_12 < n && i4_12 < 2; i4_12++) {
            if (m0 != c) break L3_0;
            m0 = (m1 | 2);
            const t483 = "x";
            e = 9007199254740991;
          }
          b = m0;
          L4_81: for (let i4_28 = 0; i4_28 < 1 && i4_28 < 1; i4_28++) {
            a = 255;
            b = (i3_26 + q);
          }
          b = 65536;
        }
        L3_97: for (let i3_13 = 0; i3_13 < 1 && i3_13 < 1; i3_13++) {
          if (i0_88 <= 5) continue L0_45;
          a = "x";
        }
        if (m1 <= b) e = null; else d = (q << d);
        m1 = -0.5;
      } while (++i2_43 < 4);
      if (b >= 1) a = "x"; else e = 4294967295;
    }
    m0 = b;
    c = e;
    e = undefined;
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
