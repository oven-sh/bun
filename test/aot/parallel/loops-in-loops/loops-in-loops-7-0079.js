let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_24 = 0, i2_62 = 0, i3_30 = 0;
  L0_5: for (let i0_94 = 3; i0_94 > 0; i0_94--) {
    const t16 = NaN;
    b = (m1 & c);
  }
  i0_24 = 0;
  L0_38: while (i0_24++ < 3) {
    L1_3: for (let i1_51 = 0; i1_51 < n && i1_51 < 2; i1_51++) {
      d = -0.5;
      i2_62 = 0;
      L2_86: while (i2_62++ < 2) {
        d = i2_62;
        m1 = i1_51;
      }
      d = (m1 + i0_24);
      i3_30 = 0;
      L2_0: while (i3_30++ < 2) {
        if (i2_62 == e) continue L0_38;
        if (e == e) break L2_0;
        c = (c + i2_62);
      }
    }
    a >>>= 0;
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
