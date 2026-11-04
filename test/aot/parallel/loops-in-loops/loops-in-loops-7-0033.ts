let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_12 = 0;
  L0_41: for (let i0_20 = 3; i0_20 > 0; i0_20--) {
    if (m1 !== m0) continue;
    L1_9: for (let i1_86 = 2; i1_86 > 0; i1_86--) {
      if (a < b) continue;
      i2_12 = 0;
      L2_65: do {
        m0 = 2;
        m1 *= 2;
      } while (++i2_12 < 3);
      m1 -= 1;
    }
    c = 2147483647;
    c = m0;
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
