let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_18 = 0;
  i0_18 = 0;
  L0_24: while (i0_18++ < 4) {
    L1_95: for (let i1_22 = 4; i1_22 > 0; i1_22--) {
      if (d === a) continue;
      if (i1_22 <= 1) d = (e ^ i0_18); else b = (a >>> 2);
      if (c >= b) b = m1; else b = (p + e);
    }
  }
  L0_99: for (let i1_49 = 3; i1_49 > 0; i1_49--) {
    d = i0_18;
    L1_13: for (let i2_51 = 0; i2_51 < n && i2_51 < 3; i2_51++) {
      d += 2;
      e = -0.5;
      b *= 2;
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
