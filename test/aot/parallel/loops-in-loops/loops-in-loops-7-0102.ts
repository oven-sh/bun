let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_24 = 0, i1_20 = 0;
  i0_24 = 0;
  L0_12: do {
    if (c !== d) d = 2; else a = q;
    i1_20 = 0;
    L1_60: while (i1_20++ < 4) {
      e >>>= 0;
      L2_25: for (let i2_2 = 0; i2_2 < p && i2_2 < 3; i2_2++) {
        if (d === i2_2) e = i0_24; else c = b;
      }
    }
  } while (++i0_24 < 2);
  L0_20: for (let i2_82 = 0; i2_82 < n && i2_82 < 3; i2_82++) {
    e = (d + d);
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
