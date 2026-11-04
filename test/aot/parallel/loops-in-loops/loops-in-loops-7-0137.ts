let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_65 = 0;
  L0_45: for (let i0_64 = 2; i0_64 > 0; i0_64--) {
    if (q === c) break L0_45;
    L1_19: for (let i1_2 = 0; i1_2 < p && i1_2 < 4; i1_2++) {
      d >>>= 0;
    }
    if (b > e) continue L0_45;
    b = 2147483648;
  }
  L0_95: for (let i0_46 = 1; i0_46 > 0; i0_46--) {
    m1 = b;
    const t983 = 4294967295;
    i1_65 = 0;
    L1_71: do {
      d = (e & 1);
    } while (++i1_65 < 4);
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
