let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_21 = 0;
  L0_44: for (let i0_8 = 0; i0_8 < 4 && i0_8 < 4; i0_8++) {
    L1_58: for (let i1_35 = 0; i1_35 < p && i1_35 < 2; i1_35++) {
      c = true;
      a -= 1;
      b = (q & i0_8);
      i2_21 = 0;
      L2_33: while (i2_21++ < 1) {
        if (i0_8 != 100) break;
      }
    }
    e = (i0_8 >> e);
    c += 1;
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
