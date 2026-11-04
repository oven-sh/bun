let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_83 = 0;
  L0_51: for (let i0_28 = 0; i0_28 < p && i0_28 < 1; i0_28++) {
    if (m1 !== m0) continue;
    m1 = (i0_28 * 2);
  }
  L0_3: for (let i0_7 = 0; i0_7 < n && i0_7 < 3; i0_7++) {
    if (m1 != 2) break;
    if (b > 1) b = p; else b = (p * i0_7);
    e = m1;
    L1_17: for (let i1_14 = 0; i1_14 < n && i1_14 < 3; i1_14++) {
      if (p >= 5) c = undefined; else d = 2;
      i2_83 = 0;
      L2_13: while (i2_83++ < 1) {
        if (q > m0) break L0_3;
      }
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
