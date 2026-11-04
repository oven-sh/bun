let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i3_54 = 0;
  L0_51: for (let i0_36 = 0; i0_36 < 4 && i0_36 < 4; i0_36++) {
    L1_64: for (let i1_68 = 0; i1_68 < 2 && i1_68 < 2; i1_68++) {
      L2_89: for (let i2_62 = 0; i2_62 < p && i2_62 < 4; i2_62++) {
        b = e;
        i3_54 = 0;
        L3_50: while (i3_54++ < 4) {
          a = m0;
        }
      }
    }
    b = -0;
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
