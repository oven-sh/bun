let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_72 = 0;
  L0_56: for (let i0_75 = 0; i0_75 < 1 && i0_75 < 1; i0_75++) {
    m0++;
    L1_16: for (let i1_46 = 0; i1_46 < 3 && i1_46 < 3; i1_46++) {
      b = (m1 - d);
    }
    if (b > e) continue L0_56;
    b = a;
  }
  i0_72 = 0;
  L0_95: while (i0_72++ < 1) {
    a--;
    a = true;
    if (e != e) break L0_95;
    d = undefined;
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
