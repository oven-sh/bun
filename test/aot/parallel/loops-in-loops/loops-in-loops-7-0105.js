let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_80 = 0, i1_91 = 0;
  i0_80 = 0;
  L0_20: do {
    L1_91: for (let i1_55 = 0; i1_55 < p && i1_55 < 2; i1_55++) {
      if (q === a) continue;
      c -= 1;
      b++;
      if (e < p) continue;
    }
    L1_20: for (let i1_88 = 0; i1_88 < p && i1_88 < 1; i1_88++) {
      L2_3: for (let i2_38 = 3; i2_38 > 0; i2_38--) {
        if (p == d) break L2_3;
        if (i2_38 != 0) a = 3; else d = (i2_38 ^ p);
      }
    }
  } while (++i0_80 < 2);
  i1_91 = 0;
  L0_48: while (i1_91++ < 3) {
    L1_5: for (let i2_75 = 0; i2_75 < 3 && i2_75 < 3; i2_75++) {
      m1 += 2;
      e += 1;
    }
    c -= 1;
    a = 0;
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
