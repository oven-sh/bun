let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i3_79 = 0, i4_22 = 0;
  L0_0: for (let i0_66 = 0; i0_66 < n && i0_66 < 2; i0_66++) {
    L1_29: for (let i1_89 = 0; i1_89 < n && i1_89 < 3; i1_89++) {
      if (i1_89 == c) break L0_0;
      e = a;
      L2_93: for (let i2_11 = 0; i2_11 < 4 && i2_11 < 4; i2_11++) {
        i3_79 = 0;
        L3_67: while (i3_79++ < 2) {
          c *= 2;
          m1 = i2_11;
          i4_22 = 0;
          L4_57: while (i4_22++ < 3) {
            c = d;
            if (i4_22 !== a) e = (b * d); else b = (q * a);
            b = e;
            m1 -= 1;
          }
          if (q === i2_11) c = e; else c = c;
        }
      }
      m1 = m0;
    }
    if (a >= c) d = 3; else d = (m0 - i4_22);
  }
  L0_15: for (let i2_71 = 0; i2_71 < 1 && i2_71 < 1; i2_71++) {
    if (m1 == 100) break;
    if (d === c) break;
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
