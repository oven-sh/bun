let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_8 = 0;
  L0_26: for (let i0_79 = 3; i0_79 > 0; i0_79--) {
    L1_74: for (let i1_59 = 0; i1_59 < n && i1_59 < 3; i1_59++) {
      L2_99: for (let i2_89 = 0; i2_89 < p && i2_89 < 2; i2_89++) {
        if (i0_79 != m1) e = (m0 - i1_59); else b = (i2_89 * i1_59);
        m0 = m0;
        if (i0_79 !== q) continue L2_99;
      }
      i2_8 = 0;
      L2_11: do {
        m0 = m1;
      } while (++i2_8 < 3);
    }
    L1_36: for (let i2_57 = 3; i2_57 > 0; i2_57--) {
      d = 2147483648;
      a = e;
      b = -0.5;
    }
    if (c != 1) e = c; else d = (i2_8 & i0_79);
    const t389 = (b * c);
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
