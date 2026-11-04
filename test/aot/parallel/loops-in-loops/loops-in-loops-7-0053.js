let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_42 = 0;
  L0_79: for (let i0_75 = 0; i0_75 < 1 && i0_75 < 1; i0_75++) {
    i1_42 = 0;
    L1_73: do {
      c >>>= 0;
      a -= 1;
      if (p < e) b = e; else a = 7;
    } while (++i1_42 < 3);
    e += 1;
    L1_71: for (let i2_4 = 0; i2_4 < n && i2_4 < 1; i2_4++) {
      c -= 1;
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
