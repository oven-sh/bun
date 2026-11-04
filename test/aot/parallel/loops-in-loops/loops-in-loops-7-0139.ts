let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_27: for (let i0_35 = 0; i0_35 < n && i0_35 < 4; i0_35++) {
    m0 += 1;
  }
  L0_67: for (let i0_26 = 4; i0_26 > 0; i0_26--) {
    if (p != 100) a = 0.5; else a = (e - m0);
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
