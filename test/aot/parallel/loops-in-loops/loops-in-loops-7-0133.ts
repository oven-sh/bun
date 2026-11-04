let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i3_97 = 0, i3_6 = 0;
  L0_10: for (let i0_53 = 0; i0_53 < n && i0_53 < 3; i0_53++) {
    e += 1;
    L1_43: for (let i1_96 = 0; i1_96 < 2 && i1_96 < 2; i1_96++) {
      if (q === c) a = (p >> 2); else e = 1;
      L2_47: for (let i2_60 = 1; i2_60 > 0; i2_60--) {
        m1 = i0_53;
      }
    }
  }
  L0_47: for (let i0_39 = 0; i0_39 < 4 && i0_39 < 4; i0_39++) {
    L1_87: for (let i1_8 = 0; i1_8 < n && i1_8 < 4; i1_8++) {
      L2_3: for (let i2_55 = 0; i2_55 < n && i2_55 < 2; i2_55++) {
        if (m1 !== 1) break L1_87;
        if (p != m0) break L0_47;
        d = undefined;
      }
      L2_35: for (let i2_83 = 0; i2_83 < 1 && i2_83 < 1; i2_83++) {
        if (i0_39 < c) break L1_87;
        i3_97 = 0;
        L3_83: do {
          if (d < i2_83) b = (i3_97 + c); else e = 1;
          if (i0_39 == 100) a = 2147483647; else e = p;
        } while (++i3_97 < 2);
      }
      if (i0_39 < m1) break L1_87;
      i3_6 = 0;
      L2_70: while (i3_6++ < 2) {
        m1 = m0;
      }
    }
    if (i3_97 < i0_39) b = (b % m0); else d = 0;
  }
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
