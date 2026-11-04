let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  L0_85: for (let i0_29 = 0; i0_29 < p && i0_29 < 4; i0_29++) {
    if (m1 == i0_29) continue;
    if (b == d) continue;
  }
  L0_91: for (let i0_91 = 0; i0_91 < n && i0_91 < 2; i0_91++) {
    if (q == p) b = (a ^ m0); else d = (a - e);
    if (c >= p) c = q; else d = 9007199254740991;
    if (a !== p) c = 65536; else b = (m0 * p);
    L1_93: for (let i1_15 = 0; i1_15 < p && i1_15 < 4; i1_15++) {
      d = 0;
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
