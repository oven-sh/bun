let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_16 = 0;
  L0_29: for (let i0_68 = 2; i0_68 > 0; i0_68--) {
    m1 = e;
    L1_96: for (let i1_89 = 0; i1_89 < p && i1_89 < 3; i1_89++) {
      L2_41: for (let i2_7 = 4; i2_7 > 0; i2_7--) {
        const t350 = NaN;
      }
      L2_38: for (let i2_48 = 0; i2_48 < 1 && i2_48 < 1; i2_48++) {
        m1 += 2;
        L3_50: for (let i3_50 = 4; i3_50 > 0; i3_50--) {
          b = 9007199254740991;
          a = m1;
          if (b === i1_89) continue L2_38;
          b = (c * i2_48);
        }
        if (e !== p) e = e; else e = (p >> q);
        if (e == q) a = p; else e = c;
      }
    }
    d >>>= 0;
    L1_29: for (let i1_14 = 3; i1_14 > 0; i1_14--) {
      if (a === m1) continue;
      L2_60: for (let i2_36 = 0; i2_36 < p && i2_36 < 3; i2_36++) {
        b |= 0;
      }
    }
  }
  i0_16 = 0;
  L0_46: do {
    if (e <= 0) a = m0; else c = 2;
    c >>>= 0;
  } while (++i0_16 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
