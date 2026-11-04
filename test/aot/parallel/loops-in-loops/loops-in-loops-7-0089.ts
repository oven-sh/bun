let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_58 = 0;
  i0_58 = 0;
  L0_80: while (i0_58++ < 3) {
    if (d > i0_58) b = undefined; else c = (q | b);
    b--;
    e = (b | 1);
  }
  L0_12: for (let i1_36 = 2; i1_36 > 0; i1_36--) {
    d = e;
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
