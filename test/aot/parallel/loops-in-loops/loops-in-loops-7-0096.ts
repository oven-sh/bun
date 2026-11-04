let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_56 = 0, i2_50 = 0;
  L0_4: for (let i0_42 = 0; i0_42 < n && i0_42 < 2; i0_42++) {
    m1 = (b << b);
    i1_56 = 0;
    L1_65: while (i1_56++ < 3) {
      i2_50 = 0;
      L2_49: do {
        L3_97: for (let i3_14 = 0; i3_14 < 3 && i3_14 < 3; i3_14++) {
          if (d >= a) break;
        }
      } while (++i2_50 < 2);
      b = (d | i2_50);
      if (m1 !== d) break L1_65;
    }
    if (m1 <= 100) d = d; else d = i1_56;
    L1_29: for (let i3_1 = 0; i3_1 < n && i3_1 < 1; i3_1++) {
      if (i1_56 >= m1) break;
      a += 2;
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
