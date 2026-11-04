let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_55 = 0;
  L0_66: for (let i0_12 = 0; i0_12 < 3 && i0_12 < 3; i0_12++) {
    e = (e & i0_12);
    e = q;
    i1_55 = 0;
    L1_59: while (i1_55++ < 3) {
      e = (a << b);
      m0 = e;
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
