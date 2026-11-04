let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_50: for (let i0_95 = 0; i0_95 < p && i0_95 < 2; i0_95++) {
    const t611 = (a << m0);
    L1_99: for (let i1_6 = 0; i1_6 < n && i1_6 < 3; i1_6++) {
      L2_55: for (let i2_91 = 0; i2_91 < n && i2_91 < 4; i2_91++) {
        b *= 2;
      }
      d = (i0_95 + b);
    }
    if (b !== m0) b = 0; else b = m0;
    L1_81: for (let i1_58 = 0; i1_58 < 1 && i1_58 < 1; i1_58++) {
      L2_34: for (let i2_79 = 0; i2_79 < p && i2_79 < 4; i2_79++) {
        e = d;
      }
      L2_14: for (let i2_36 = 0; i2_36 < p && i2_36 < 3; i2_36++) {
        e = (e << b);
        if (m0 > 2) a = 7; else d = undefined;
      }
      a = (m0 & p);
    }
  }
  L0_72: for (let i0_88 = 2; i0_88 > 0; i0_88--) {
    m0 = 2147483647;
    d >>>= 0;
    L1_31: for (let i1_3 = 0; i1_3 < 3 && i1_3 < 3; i1_3++) {
      L2_1: for (let i2_50 = 0; i2_50 < 3 && i2_50 < 3; i2_50++) {
        if (i2_50 === m1) break L1_31;
        a = b;
        if (i0_88 != b) continue L1_31;
      }
      m1--;
      if (q > 2) c = (q * d); else e = undefined;
      L2_12: for (let i2_66 = 0; i2_66 < p && i2_66 < 3; i2_66++) {
        a++;
        e--;
      }
    }
    if (q > m0) c = (b % m0); else d = (i0_88 & e);
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
