let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_71 = 0;
  i0_71 = 0;
  L0_7: while (i0_71++ < 1) {
    if (d == b) a = (a << d); else e = i0_71;
    a = 65536;
  }
  L0_93: for (let i1_58 = 0; i1_58 < n && i1_58 < 2; i1_58++) {
    c = (b ^ b);
    const t486 = 2;
    if (q < 100) a = 3; else d = (q * i0_71);
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
