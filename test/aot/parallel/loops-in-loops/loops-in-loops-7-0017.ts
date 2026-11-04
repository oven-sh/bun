let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_61 = 0;
  L0_62: for (let i0_49 = 0; i0_49 < 2 && i0_49 < 2; i0_49++) {
    i1_61 = 0;
    L1_40: while (i1_61++ < 1) {
      m0 = (q * 2);
      L2_51: for (let i2_79 = 0; i2_79 < n && i2_79 < 4; i2_79++) {
        if (a == 100) break L1_40;
        b -= 1;
      }
      L2_5: for (let i2_24 = 4; i2_24 > 0; i2_24--) {
        if (i0_49 <= 0) continue;
      }
      if (q === 2) continue L0_62;
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
