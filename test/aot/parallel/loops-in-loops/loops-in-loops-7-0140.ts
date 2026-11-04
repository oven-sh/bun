let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_27 = 0, i4_81 = 0;
  i0_27 = 0;
  L0_62: do {
    L1_68: for (let i1_47 = 0; i1_47 < 4 && i1_47 < 4; i1_47++) {
      L2_66: for (let i2_48 = 0; i2_48 < p && i2_48 < 1; i2_48++) {
        if (m1 == 2) c = 0.5; else d = (i0_27 << c);
        L3_0: for (let i3_17 = 0; i3_17 < n && i3_17 < 1; i3_17++) {
          L4_60: for (let i4_85 = 0; i4_85 < p && i4_85 < 3; i4_85++) {
            c = (e ^ a);
            b = (e & i2_48);
            const t149 = m0;
            b = e;
          }
          i4_81 = 0;
          L4_94: while (i4_81++ < 2) {
            b = (c * i2_48);
          }
          a = (d - i1_47);
        }
      }
      L2_11: for (let i3_4 = 0; i3_4 < 3 && i3_4 < 3; i3_4++) {
        if (b == m0) break;
        L3_69: for (let i4_0 = 0; i4_0 < p && i4_0 < 3; i4_0++) {
          e = (m1 << i1_47);
        }
      }
      m0 -= 1;
    }
    L1_90: for (let i2_89 = 0; i2_89 < 1 && i2_89 < 1; i2_89++) {
      if (q === i0_27) break L0_62;
    }
  } while (++i0_27 < 3);
  L0_5: for (let i2_32 = 3; i2_32 > 0; i2_32--) {
    const t9 = m1;
    e += 1;
    if (p != 5) break;
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
