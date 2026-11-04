let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_62 = 0;
  i0_62 = 0;
  L0_49: do {
    d += 2;
    c += 1;
  } while (++i0_62 < 3);
  L0_26: for (let i1_52 = 0; i1_52 < 1 && i1_52 < 1; i1_52++) {
    L1_48: for (let i2_17 = 0; i2_17 < n && i2_17 < 3; i2_17++) {
      L2_64: for (let i3_82 = 3; i3_82 > 0; i3_82--) {
        L3_45: for (let i4_96 = 0; i4_96 < 4 && i4_96 < 4; i4_96++) {
          if (i0_62 === m1) b = (d >> b); else e = (m1 << q);
        }
        const t561 = (a >> 1);
      }
    }
    if (i1_52 !== m0) continue L0_26;
    e = p;
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
