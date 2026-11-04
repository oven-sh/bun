let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_29 = 0, i3_70 = 0;
  i0_29 = 0;
  L0_17: do {
    L1_85: for (let i1_99 = 0; i1_99 < n && i1_99 < 1; i1_99++) {
      if (i0_29 === m1) break L1_85;
      b = e;
      L2_24: for (let i2_74 = 0; i2_74 < n && i2_74 < 3; i2_74++) {
        L3_67: for (let i3_64 = 2; i3_64 > 0; i3_64--) {
          if (a <= a) continue;
        }
        L3_57: for (let i3_29 = 0; i3_29 < n && i3_29 < 3; i3_29++) {
          b = -0;
          a = -0.5;
        }
        e = p;
      }
    }
    L1_81: for (let i1_13 = 4; i1_13 > 0; i1_13--) {
      c = a;
      c = q;
      L2_41: for (let i2_1 = 3; i2_1 > 0; i2_1--) {
        c = a;
        i3_70 = 0;
        L3_61: do {
          L4_70: for (let i4_84 = 2; i4_84 > 0; i4_84--) {
            if (i1_13 === q) continue;
          }
        } while (++i3_70 < 1);
        if (i1_13 < m0) continue;
      }
    }
  } while (++i0_29 < 3);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
