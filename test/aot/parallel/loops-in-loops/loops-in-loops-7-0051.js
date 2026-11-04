let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_92 = 0, i2_46 = 0;
  i0_92 = 0;
  L0_86: while (i0_92++ < 3) {
    if (m0 !== m1) break L0_86;
    L1_81: for (let i1_67 = 0; i1_67 < 1 && i1_67 < 1; i1_67++) {
      const t150 = (m1 ^ p);
      i2_46 = 0;
      L2_67: while (i2_46++ < 2) {
        a -= 1;
        b = 1;
        m1 = b;
        m0 = i2_46;
      }
      d = m1;
      const t753 = 2147483648;
    }
    if (i2_46 <= 5) break L0_86;
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
