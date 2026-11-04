let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_52 = 0, i1_10 = 0;
  L0_27: for (let i0_47 = 0; i0_47 < n && i0_47 < 3; i0_47++) {
    L1_87: for (let i1_89 = 0; i1_89 < p && i1_89 < 1; i1_89++) {
      b |= 0;
      m0 >>>= 0;
    }
    if (i0_47 == b) break;
    e = m1;
    i1_52 = 0;
    L1_84: while (i1_52++ < 3) {
      if (d == q) continue;
      d >>>= 0;
      d = true;
      if (c < 0) continue;
    }
  }
  i1_10 = 0;
  L0_27: do {
    e |= 0;
    if (a <= i1_52) b = (c >> m1); else c = 2;
    if (q == m0) break L0_27;
  } while (++i1_10 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
