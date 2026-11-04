let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_10 = 0, i4_13 = 0;
  L0_95: for (let i0_9 = 2; i0_9 > 0; i0_9--) {
    i1_10 = 0;
    L1_78: do {
      b |= 0;
      if (m0 === d) e = (c << i0_9); else c = q;
      L2_31: for (let i2_30 = 3; i2_30 > 0; i2_30--) {
        if (i2_30 == e) b = i0_9; else a = b;
        if (q != 2) a = 2147483648; else a = 3;
        e = (d * 1);
        L3_41: for (let i3_52 = 0; i3_52 < p && i3_52 < 2; i3_52++) {
          if (e >= a) b = (a << b); else c = p;
          i4_13 = 0;
          L4_3: while (i4_13++ < 3) {
            c = (m0 + 1);
            a = q;
            if (m0 != m0) continue;
            e = 7;
          }
        }
      }
      c++;
    } while (++i1_10 < 3);
    a = (m0 + i1_10);
    L1_61: for (let i3_92 = 0; i3_92 < n && i3_92 < 1; i3_92++) {
      m1 -= 1;
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
