let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_21 = 0;
  L0_1: for (let i0_59 = 1; i0_59 > 0; i0_59--) {
    if (q > 2) e = (m0 << c); else a = (b >>> e);
    if (d < b) a = (i0_59 * a); else d = 65536;
    m0 = i0_59;
    i1_21 = 0;
    L1_12: while (i1_21++ < 4) {
      c = (d | i1_21);
      c += 2;
      a = NaN;
      a *= 2;
    }
  }
  L0_68: for (let i1_84 = 0; i1_84 < n && i1_84 < 3; i1_84++) {
    d++;
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
