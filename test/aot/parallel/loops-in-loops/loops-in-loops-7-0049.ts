let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_11: for (let i0_45 = 3; i0_45 > 0; i0_45--) {
    if (b > 1) break;
    d = (i0_45 & c);
    L1_87: for (let i1_67 = 0; i1_67 < p && i1_67 < 2; i1_67++) {
      L2_48: for (let i2_41 = 2; i2_41 > 0; i2_41--) {
        c += 1;
        if (i0_45 === i2_41) break L0_11;
        m1 = (a >> d);
      }
      if (m0 > p) e = "x"; else b = (c * m0);
      if (i1_67 <= b) continue;
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
