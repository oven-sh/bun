let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_90: for (let i0_32 = 0; i0_32 < n && i0_32 < 2; i0_32++) {
    d = m1;
    m0 = (q >>> 3);
    L1_41: for (let i1_96 = 0; i1_96 < 3 && i1_96 < 3; i1_96++) {
      if (i0_32 >= 0) c = d; else c = (c << b);
      m1 = q;
      a--;
      L2_27: for (let i2_20 = 0; i2_20 < p && i2_20 < 4; i2_20++) {
        L3_66: for (let i3_52 = 1; i3_52 > 0; i3_52--) {
          m1 = (p + i3_52);
          a += 1;
        }
        if (m1 > m1) continue L0_90;
      }
    }
  }
  L0_32: for (let i0_43 = 0; i0_43 < p && i0_43 < 1; i0_43++) {
    if (q > 0) break;
    if (m0 === b) break L0_32;
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
