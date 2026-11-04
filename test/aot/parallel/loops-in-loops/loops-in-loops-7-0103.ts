let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_32 = 0, i2_50 = 0;
  i0_32 = 0;
  L0_11: do {
    c = (i0_32 | d);
    L1_52: for (let i1_92 = 0; i1_92 < 1 && i1_92 < 1; i1_92++) {
      a >>>= 0;
    }
  } while (++i0_32 < 3);
  L0_62: for (let i1_89 = 0; i1_89 < 1 && i1_89 < 1; i1_89++) {
    m1 = 4294967295;
    i2_50 = 0;
    L1_28: do {
      if (m0 != 1) continue L1_28;
    } while (++i2_50 < 3);
    d = (d >> p);
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
