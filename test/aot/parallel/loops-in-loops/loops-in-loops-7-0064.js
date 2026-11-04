let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_42: for (let i0_91 = 0; i0_91 < p && i0_91 < 3; i0_91++) {
    L1_52: for (let i1_17 = 1; i1_17 > 0; i1_17--) {
      b++;
      e = e;
    }
    d = e;
    if (p == 0) break L0_42;
    m1 |= 0;
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
