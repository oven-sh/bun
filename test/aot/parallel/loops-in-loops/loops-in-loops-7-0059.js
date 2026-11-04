let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_94 = 0, i1_17 = 0;
  L0_17: for (let i0_96 = 0; i0_96 < 3 && i0_96 < 3; i0_96++) {
    m1 = (i0_96 * 1);
    if (m1 >= q) break L0_17;
    i1_94 = 0;
    L1_46: do {
      b += 2;
      const t824 = a;
    } while (++i1_94 < 1);
  }
  i1_17 = 0;
  L0_38: while (i1_17++ < 2) {
    b = 255;
    c = (i1_94 >> a);
    if (d < b) break L0_38;
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
