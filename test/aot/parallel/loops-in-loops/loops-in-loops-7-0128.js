let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_70 = 0, i1_11 = 0;
  i0_70 = 0;
  L0_89: do {
    if (e < m1) a = (m0 >>> a); else c = 3;
  } while (++i0_70 < 3);
  i1_11 = 0;
  L0_79: while (i1_11++ < 1) {
    b += 1;
    a = 255;
    if (q < b) continue L0_79;
    if (a > b) c = b; else e = (q | 2);
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
