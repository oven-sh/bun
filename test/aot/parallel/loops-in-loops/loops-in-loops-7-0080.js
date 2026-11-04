let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_84: for (let i0_72 = 0; i0_72 < p && i0_72 < 2; i0_72++) {
    L1_52: for (let i1_91 = 0; i1_91 < n && i1_91 < 1; i1_91++) {
      L2_9: for (let i2_37 = 0; i2_37 < 3 && i2_37 < 3; i2_37++) {
        d = (m1 << b);
        d *= 2;
        L3_24: for (let i3_71 = 0; i3_71 < p && i3_71 < 3; i3_71++) {
          if (c === i2_37) continue L2_9;
          L4_86: for (let i4_32 = 1; i4_32 > 0; i4_32--) {
            if (i2_37 >= m0) break;
          }
          c += 1;
        }
        if (i0_72 >= 1) a = (m0 | i1_91); else d = (i0_72 | q);
      }
    }
    const t389 = (c ^ d);
    if (e <= a) break;
  }
  L0_78: for (let i0_51 = 3; i0_51 > 0; i0_51--) {
    if (m1 !== q) e = 9007199254740991; else d = m1;
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
