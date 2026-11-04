let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_46: for (let i0_67 = 0; i0_67 < 4 && i0_67 < 4; i0_67++) {
    L1_82: for (let i1_71 = 0; i1_71 < n && i1_71 < 4; i1_71++) {
      m0 = 65536;
    }
  }
  L0_24: for (let i0_1 = 4; i0_1 > 0; i0_1--) {
    e = 2147483647;
    m1 = (c ^ i0_1);
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
