let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i4_69 = 0, i4_59 = 0, i2_56 = 0, i3_28 = 0, i4_89 = 0;
  L0_52: for (let i0_59 = 3; i0_59 > 0; i0_59--) {
    e = (b + b);
    L1_79: for (let i1_99 = 0; i1_99 < p && i1_99 < 3; i1_99++) {
      c = (a >>> q);
      L2_18: for (let i2_27 = 0; i2_27 < p && i2_27 < 1; i2_27++) {
        L3_10: for (let i3_62 = 3; i3_62 > 0; i3_62--) {
          i4_69 = 0;
          L4_93: do {
            c = (i4_69 >>> i3_62);
            c = (c | i0_59);
            c = (p - i3_62);
          } while (++i4_69 < 2);
          if (a === i4_69) a = i2_27; else b = (a ^ q);
        }
        if (m1 >= 5) e = p; else d = e;
        a = -0;
        i4_59 = 0;
        L3_63: do {
          if (i1_99 < i4_69) break;
        } while (++i4_59 < 2);
      }
      if (c != i4_69) continue;
    }
  }
  i2_56 = 0;
  L0_14: while (i2_56++ < 2) {
    m1 = 0.5;
    i3_28 = 0;
    L1_32: do {
      a += 2;
      if (i3_28 != c) a = 4294967295; else b = 65536;
      if (d < m1) break;
    } while (++i3_28 < 1);
    i4_89 = 0;
    L1_43: while (i4_89++ < 3) {
      c = i3_28;
      if (i2_56 >= m1) c = (m1 + i2_56); else a = (i4_59 | q);
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
