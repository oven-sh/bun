let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_18 = 0, i1_15 = 0;
  i0_18 = 0;
  L0_71: do {
    c = true;
    i1_15 = 0;
    L1_93: do {
      m0 = (m1 << p);
    } while (++i1_15 < 2);
    if (q < m1) break L0_71;
    if (i1_15 < e) continue L0_71;
  } while (++i0_18 < 4);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
