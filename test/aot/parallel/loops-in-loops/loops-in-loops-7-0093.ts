let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_44 = 0, i1_91 = 0;
  i0_44 = 0;
  L0_21: do {
    d = 0;
    e = (c | 1);
    i1_91 = 0;
    L1_14: do {
      if (a > b) continue;
    } while (++i1_91 < 1);
  } while (++i0_44 < 3);
  L0_39: for (let i2_10 = 0; i2_10 < p && i2_10 < 4; i2_10++) {
    L1_72: for (let i3_82 = 0; i3_82 < n && i3_82 < 4; i3_82++) {
      if (i0_44 > p) c = 2147483648; else b = NaN;
      if (i3_82 < 0) d = (a * m0); else c = m1;
    }
    const t799 = 65536;
    m1 = 255;
    if (e == b) c = 9007199254740991; else b = (q ^ e);
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
