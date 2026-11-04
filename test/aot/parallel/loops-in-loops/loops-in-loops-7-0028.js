let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_79 = 0, i1_63 = 0;
  L0_91: for (let i0_6 = 0; i0_6 < p && i0_6 < 3; i0_6++) {
    i1_79 = 0;
    L1_95: do {
      m1--;
    } while (++i1_79 < 1);
    m0++;
    if (d <= p) b = 2147483647; else b = a;
    d = c;
  }
  i1_63 = 0;
  L0_75: while (i1_63++ < 3) {
    if (c === i1_63) break L0_75;
    m0 = (m1 >>> 2);
    c = 255;
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
