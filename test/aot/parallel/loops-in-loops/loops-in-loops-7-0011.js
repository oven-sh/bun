let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_16 = 0, i2_62 = 0, i3_35 = 0;
  i0_16 = 0;
  L0_87: while (i0_16++ < 4) {
    b = 4294967295;
    c++;
  }
  L0_4: for (let i1_16 = 3; i1_16 > 0; i1_16--) {
    i2_62 = 0;
    L1_0: do {
      L2_13: for (let i3_31 = 0; i3_31 < 2 && i3_31 < 2; i3_31++) {
        L3_89: for (let i4_92 = 0; i4_92 < p && i4_92 < 3; i4_92++) {
          b = a;
        }
      }
      if (e > m0) continue;
      const t114 = e;
      if (m1 >= 0) c = m1; else a = e;
    } while (++i2_62 < 1);
    i3_35 = 0;
    L1_40: do {
      if (a == m0) a = i2_62; else d = d;
      if (i0_16 >= 2) break;
    } while (++i3_35 < 2);
    const t735 = 4294967295;
    a += 2;
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
