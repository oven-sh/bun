let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_53 = 0, i4_79 = 0;
  i0_53 = 0;
  L0_89: do {
    L1_17: for (let i1_36 = 0; i1_36 < p && i1_36 < 2; i1_36++) {
      L2_94: for (let i2_8 = 0; i2_8 < 4 && i2_8 < 4; i2_8++) {
        L3_40: for (let i3_41 = 0; i3_41 < p && i3_41 < 1; i3_41++) {
          i4_79 = 0;
          L4_37: while (i4_79++ < 3) {
            m1 = (p ^ i2_8);
            m0 = 65536;
            if (p > 1) b = (e >> q); else c = (m1 * p);
          }
        }
      }
    }
    c = -1;
  } while (++i0_53 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
