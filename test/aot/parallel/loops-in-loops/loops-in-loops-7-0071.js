let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_33 = 0, i4_81 = 0, i2_80 = 0, i3_3 = 0;
  L0_68: for (let i0_96 = 3; i0_96 > 0; i0_96--) {
    L1_50: for (let i1_35 = 3; i1_35 > 0; i1_35--) {
      if (e <= m1) d = (m1 + 3); else e = p;
      i2_33 = 0;
      L2_31: while (i2_33++ < 1) {
        L3_52: for (let i3_86 = 0; i3_86 < 1 && i3_86 < 1; i3_86++) {
          i4_81 = 0;
          L4_95: do {
            c = 65536;
            c = (i3_86 * 3);
            c += 1;
            m0 = i1_35;
          } while (++i4_81 < 1);
          a = (i4_81 | q);
        }
      }
      e += 2;
      L2_16: for (let i4_86 = 0; i4_86 < p && i4_86 < 2; i4_86++) {
        if (e < p) c = m1; else d = undefined;
        const t790 = -0;
      }
    }
    b = (b & i0_96);
    if (b !== a) break;
    c = i4_81;
  }
  i2_80 = 0;
  L0_97: do {
    if (i2_80 < b) e = (i2_80 - d); else c = (i2_33 ^ m0);
    if (d >= m1) break L0_97;
    i3_3 = 0;
    L1_64: do {
      m0 = b;
      if (i4_81 == 5) continue L0_97;
      if (a !== 100) continue;
    } while (++i3_3 < 3);
  } while (++i2_80 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
