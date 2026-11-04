let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_61 = 0, i1_64 = 0;
  L0_81: for (let i0_19 = 0; i0_19 < p && i0_19 < 3; i0_19++) {
    if (b != m1) d = 1; else b = i0_19;
    i1_61 = 0;
    L1_88: while (i1_61++ < 2) {
      e = 9007199254740991;
    }
    if (a === c) c = 2; else c = (m1 << 2);
  }
  i1_64 = 0;
  L0_42: while (i1_64++ < 2) {
    L1_94: for (let i2_51 = 0; i2_51 < p && i2_51 < 2; i2_51++) {
      a++;
      L2_33: for (let i3_60 = 2; i3_60 > 0; i3_60--) {
        m0 *= 2;
        L3_10: for (let i4_46 = 0; i4_46 < 2 && i4_46 < 2; i4_46++) {
          b = 2147483648;
          L4_83: for (let i5_61 = 3; i5_61 > 0; i5_61--) {
            a = (i2_51 | i1_61);
          }
          m0 *= 2;
          m0 = 255;
        }
        L3_92: for (let i4_10 = 0; i4_10 < 2 && i4_10 < 2; i4_10++) {
          d = (i4_10 * 2);
        }
      }
      if (i1_61 > e) break;
      m0 = (q << 3);
    }
    m1 = d;
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
