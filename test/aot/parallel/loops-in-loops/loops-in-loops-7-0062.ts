let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_25 = 0, i1_81 = 0, i2_84 = 0;
  i0_25 = 0;
  L0_65: do {
    c = (p >>> e);
    if (m0 === m0) d = m0; else d = (m0 >> m0);
    i1_81 = 0;
    L1_0: while (i1_81++ < 2) {
      const t747 = 3;
      i2_84 = 0;
      L2_14: while (i2_84++ < 1) {
        L3_51: for (let i3_6 = 0; i3_6 < p && i3_6 < 4; i3_6++) {
          if (i0_25 != a) d = (i3_6 >>> m1); else e = 255;
          m0 = (i0_25 >> c);
          e += 2;
          if (m1 !== c) break L2_14;
        }
      }
      m1 = 9007199254740991;
    }
  } while (++i0_25 < 1);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
