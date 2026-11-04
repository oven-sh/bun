let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_90 = 0, i2_54 = 0;
  L0_16: for (let i0_46 = 4; i0_46 > 0; i0_46--) {
    i1_90 = 0;
    L1_46: do {
      b++;
      L2_57: for (let i2_87 = 0; i2_87 < p && i2_87 < 3; i2_87++) {
        d *= 2;
        c = i0_46;
      }
      L2_25: for (let i2_15 = 1; i2_15 > 0; i2_15--) {
        a = -0.5;
        if (i0_46 == m0) break L1_46;
        m1 = (d * e);
      }
      c -= 1;
    } while (++i1_90 < 2);
    i2_54 = 0;
    L1_3: while (i2_54++ < 3) {
      const t50 = (i2_54 >> m1);
      L2_36: for (let i3_82 = 0; i3_82 < p && i3_82 < 3; i3_82++) {
        d = e;
        m0 = (i1_90 & i2_54);
      }
    }
    e |= 0;
  }
  L0_21: for (let i2_15 = 0; i2_15 < 2 && i2_15 < 2; i2_15++) {
    if (i2_15 !== 2) continue L0_21;
    if (d <= i1_90) c = undefined; else b = 0.5;
    if (a == 0) continue L0_21;
    c++;
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
