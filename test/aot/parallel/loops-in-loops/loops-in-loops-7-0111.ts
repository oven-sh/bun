let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_57 = 0;
  L0_81: for (let i0_24 = 0; i0_24 < n && i0_24 < 3; i0_24++) {
    i1_57 = 0;
    L1_8: do {
      c = 3;
      if (q > 2) b = (i1_57 >>> 3); else c = 1;
      if (b == e) continue L1_8;
      if (e !== 5) d = p; else d = -0;
    } while (++i1_57 < 4);
  }
  L0_22: for (let i1_17 = 3; i1_17 > 0; i1_17--) {
    m1++;
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
