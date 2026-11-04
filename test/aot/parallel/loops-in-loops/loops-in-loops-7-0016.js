let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_98 = 0, i1_16 = 0;
  i0_98 = 0;
  L0_46: do {
    a = 2;
    m1--;
    c >>>= 0;
    i1_16 = 0;
    L1_1: while (i1_16++ < 1) {
      if (i1_16 <= 0) break;
      c = c;
    }
  } while (++i0_98 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
