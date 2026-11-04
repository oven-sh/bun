let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_32 = 0;
  L0_23: for (let i0_24 = 4; i0_24 > 0; i0_24--) {
    m0 = (i0_24 ^ m1);
    a = b;
    a -= 1;
    m1 += 2;
  }
  L0_11: for (let i0_55 = 1; i0_55 > 0; i0_55--) {
    e = (i0_55 | i0_55);
    L1_3: for (let i1_60 = 0; i1_60 < p && i1_60 < 3; i1_60++) {
      a = 0.5;
      i2_32 = 0;
      L2_24: while (i2_32++ < 1) {
        c++;
        m0 = (e & a);
        L3_81: for (let i3_76 = 0; i3_76 < 1 && i3_76 < 1; i3_76++) {
          if (i2_32 == i3_76) d = (i2_32 * i0_55); else a = (p & e);
        }
      }
      if (i0_55 !== 2) continue L0_11;
      if (i1_60 > i2_32) d = a; else d = undefined;
    }
    d = (e - p);
    a = 9007199254740991;
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
