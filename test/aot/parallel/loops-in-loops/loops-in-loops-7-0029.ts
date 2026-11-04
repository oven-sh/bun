let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_82: for (let i0_54 = 0; i0_54 < 1 && i0_54 < 1; i0_54++) {
    e = 255;
    L1_29: for (let i1_80 = 0; i1_80 < p && i1_80 < 3; i1_80++) {
      c += 1;
    }
    L1_84: for (let i1_57 = 4; i1_57 > 0; i1_57--) {
      d = (p & d);
      d = (m1 | d);
      m1 = (c % 1);
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
