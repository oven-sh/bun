let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_64 = 0;
  L0_67: for (let i0_74 = 2; i0_74 > 0; i0_74--) {
    L1_63: for (let i1_92 = 0; i1_92 < p && i1_92 < 2; i1_92++) {
      m1 = (q << i1_92);
      i2_64 = 0;
      L2_17: while (i2_64++ < 4) {
        L3_91: for (let i3_74 = 0; i3_74 < 2 && i3_74 < 2; i3_74++) {
          c = (i2_64 >> b);
        }
      }
    }
    if (q >= 100) continue;
    m1 = m1;
    L1_84: for (let i2_11 = 0; i2_11 < p && i2_11 < 4; i2_11++) {
      a = (q | 1);
      m0 = (i2_11 >>> 2);
      d += 2;
      L2_80: for (let i3_78 = 0; i3_78 < p && i3_78 < 2; i3_78++) {
        m0 += 2;
        if (c < 2) break;
      }
    }
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
