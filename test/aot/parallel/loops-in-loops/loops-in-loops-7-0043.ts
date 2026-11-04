let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_68 = 0, i1_51 = 0;
  L0_41: for (let i0_82 = 1; i0_82 > 0; i0_82--) {
    c += 1;
    if (c == q) d = "x"; else c = q;
    L1_26: for (let i1_41 = 0; i1_41 < 3 && i1_41 < 3; i1_41++) {
      d = m1;
    }
    i1_68 = 0;
    L1_79: while (i1_68++ < 3) {
      c++;
      if (i0_82 != a) break L0_41;
      c = 4294967295;
      if (p > i1_68) continue L1_79;
    }
  }
  i1_51 = 0;
  L0_56: while (i1_51++ < 4) {
    const t764 = (i1_68 * i1_68);
    a += 2;
    if (b === q) e = (q >> c); else e = m1;
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
