let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_58 = 0, i4_20 = 0, i3_12 = 0;
  L0_4: for (let i0_32 = 0; i0_32 < 3 && i0_32 < 3; i0_32++) {
    a = i0_32;
    i1_58 = 0;
    L1_62: while (i1_58++ < 1) {
      L2_11: for (let i2_90 = 0; i2_90 < p && i2_90 < 3; i2_90++) {
        if (p == i0_32) continue;
        L3_30: for (let i3_47 = 0; i3_47 < 2 && i3_47 < 2; i3_47++) {
          L4_70: for (let i4_7 = 0; i4_7 < n && i4_7 < 1; i4_7++) {
            b = a;
            c = null;
            a = -1;
            a = 255;
          }
          b = (i2_90 + i1_58);
          i4_20 = 0;
          L4_28: while (i4_20++ < 1) {
            b = (i1_58 - a);
            if (i2_90 !== m0) break;
            if (m0 !== e) c = a; else b = (c << 1);
          }
        }
      }
      L2_53: for (let i3_34 = 0; i3_34 < 3 && i3_34 < 3; i3_34++) {
        m1 = q;
      }
      d = i4_20;
      L2_19: for (let i3_14 = 0; i3_14 < p && i3_14 < 4; i3_14++) {
        if (e <= i3_14) break L1_62;
        c -= 1;
      }
    }
    i3_12 = 0;
    L1_49: do {
      m0 = (m1 * a);
      e *= 2;
    } while (++i3_12 < 3);
    if (i4_20 < 5) c = i1_58; else a = (e | i0_32);
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
