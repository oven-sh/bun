let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  L0_64: for (let i0_57 = 0; i0_57 < 3 && i0_57 < 3; i0_57++) {
    if (m1 != d) continue L0_64;
  }
  L0_60: for (let i0_22 = 0; i0_22 < 3 && i0_22 < 3; i0_22++) {
    c--;
    L1_65: for (let i1_64 = 0; i1_64 < p && i1_64 < 1; i1_64++) {
      m0 = m1;
      m1 = 255;
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
