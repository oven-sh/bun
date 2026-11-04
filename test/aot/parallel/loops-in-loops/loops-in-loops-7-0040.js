let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_4 = 0;
  i0_4 = 0;
  L0_20: while (i0_4++ < 3) {
    d--;
  }
  L0_45: for (let i1_15 = 0; i1_15 < p && i1_15 < 2; i1_15++) {
    if (a === d) continue L0_45;
    if (m1 > a) b = (p | c); else b = e;
    if (a < d) break L0_45;
    e = (m1 >>> d);
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
