let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_46 = 0, i1_82 = 0, i2_32 = 0, i4_49 = 0;
  i0_46 = 0;
  L0_9: while (i0_46++ < 2) {
    i1_82 = 0;
    L1_65: do {
      i2_32 = 0;
      L2_38: do {
        m0--;
        L3_43: for (let i3_58 = 0; i3_58 < 3 && i3_58 < 3; i3_58++) {
          L4_13: for (let i4_28 = 0; i4_28 < p && i4_28 < 2; i4_28++) {
            a = (b - i0_46);
            e = e;
            b = -0.5;
          }
          i4_49 = 0;
          L4_32: while (i4_49++ < 1) {
            c = q;
            c = 9007199254740991;
          }
          c = (i0_46 & m1);
          m0 = d;
        }
      } while (++i2_32 < 3);
      L2_36: for (let i4_21 = 0; i4_21 < 3 && i4_21 < 3; i4_21++) {
        L3_49: for (let i5_97 = 0; i5_97 < p && i5_97 < 3; i5_97++) {
          a = i5_97;
          c -= 1;
          d = 1;
          e = (i1_82 - d);
        }
        if (c >= q) d = d; else a = i2_32;
      }
    } while (++i1_82 < 3);
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
