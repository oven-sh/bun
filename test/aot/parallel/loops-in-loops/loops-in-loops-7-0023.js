let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_19: for (let i0_90 = 0; i0_90 < 3 && i0_90 < 3; i0_90++) {
    L1_51: for (let i1_34 = 0; i1_34 < 3 && i1_34 < 3; i1_34++) {
      if (p != 100) break L0_19;
      L2_7: for (let i2_5 = 0; i2_5 < n && i2_5 < 4; i2_5++) {
        a = (a - m1);
        if (d > 1) break L2_7;
      }
      if (m1 == i0_90) continue L0_19;
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
