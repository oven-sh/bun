let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_47: for (let i0_50 = 1; i0_50 > 0; i0_50--) {
    L1_26: for (let i1_82 = 2; i1_82 > 0; i1_82--) {
      m1 += 2;
      if (c <= 5) break;
    }
    a = null;
    L1_3: for (let i1_34 = 0; i1_34 < 1 && i1_34 < 1; i1_34++) {
      const t4 = c;
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
