let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i1_58 = 0, i2_29 = 0, i3_66 = 0;
  L0_7: for (let i0_77 = 0; i0_77 < p && i0_77 < 3; i0_77++) {
    if (c > 2) a = 4294967295; else b = (m1 >> m0);
    L1_34: for (let i1_57 = 0; i1_57 < n && i1_57 < 4; i1_57++) {
      m0 = (i0_77 % 3);
      if (a > p) continue L0_7;
      m0 |= 0;
    }
    if (d != e) break L0_7;
    d = a;
  }
  L0_18: for (let i0_36 = 0; i0_36 < n && i0_36 < 4; i0_36++) {
    a >>>= 0;
    L1_96: for (let i1_25 = 0; i1_25 < p && i1_25 < 2; i1_25++) {
      if (m0 >= m1) break;
    }
    i1_58 = 0;
    L1_69: while (i1_58++ < 1) {
      i2_29 = 0;
      L2_50: while (i2_29++ < 4) {
        i3_66 = 0;
        L3_41: while (i3_66++ < 3) {
          b = q;
          const t371 = undefined;
        }
        e += 1;
        d = 1;
      }
      d--;
      e = e;
    }
    if (a <= b) b = (i2_29 % i1_58); else c = (i1_58 & d);
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
