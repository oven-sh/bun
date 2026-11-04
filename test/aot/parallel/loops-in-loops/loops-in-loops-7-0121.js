let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_33 = 0;
  L0_68: for (let i0_9 = 0; i0_9 < 3 && i0_9 < 3; i0_9++) {
    L1_58: for (let i1_94 = 0; i1_94 < 3 && i1_94 < 3; i1_94++) {
      L2_93: for (let i2_43 = 3; i2_43 > 0; i2_43--) {
        e -= 1;
        a = -0.5;
        if (c != p) break L1_58;
      }
      e += 2;
      a--;
    }
    L1_16: for (let i1_69 = 0; i1_69 < n && i1_69 < 2; i1_69++) {
      const t772 = i0_9;
      a |= 0;
    }
  }
  i0_33 = 0;
  L0_30: while (i0_33++ < 2) {
    L1_9: for (let i1_26 = 0; i1_26 < 2 && i1_26 < 2; i1_26++) {
      e = (i1_26 ^ i0_33);
      L2_51: for (let i2_20 = 3; i2_20 > 0; i2_20--) {
        m1 >>>= 0;
        a = (i2_20 - m0);
      }
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
