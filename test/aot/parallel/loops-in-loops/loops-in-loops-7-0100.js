let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_56 = 0;
  L0_20: for (let i0_6 = 3; i0_6 > 0; i0_6--) {
    m0--;
    i1_56 = 0;
    L1_77: while (i1_56++ < 3) {
      L2_36: for (let i2_93 = 0; i2_93 < 2 && i2_93 < 2; i2_93++) {
        if (c == 2) continue L1_77;
        L3_35: for (let i3_28 = 3; i3_28 > 0; i3_28--) {
          c = 3;
          d = (i2_93 ^ p);
        }
        if (a !== 0) b = i2_93; else d = c;
        b >>>= 0;
      }
    }
    L1_25: for (let i2_26 = 0; i2_26 < p && i2_26 < 2; i2_26++) {
      c = (e >>> i1_56);
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
