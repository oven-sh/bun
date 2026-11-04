let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_72 = 0;
  L0_39: for (let i0_0 = 0; i0_0 < n && i0_0 < 4; i0_0++) {
    L1_1: for (let i1_75 = 0; i1_75 < 1 && i1_75 < 1; i1_75++) {
      i2_72 = 0;
      L2_34: while (i2_72++ < 4) {
        if (i1_75 <= e) break L2_34;
        L3_3: for (let i3_13 = 0; i3_13 < 1 && i3_13 < 1; i3_13++) {
          L4_55: for (let i4_78 = 1; i4_78 > 0; i4_78--) {
            const t592 = m1;
          }
          c = e;
          if (m0 <= p) break;
          d++;
        }
      }
      d = "x";
      e -= 1;
      a = m1;
    }
    L1_0: for (let i2_40 = 0; i2_40 < n && i2_40 < 3; i2_40++) {
      L2_8: for (let i3_63 = 2; i3_63 > 0; i3_63--) {
        if (m0 >= 0) continue;
        m0 >>>= 0;
        m1 = c;
        d = e;
      }
      c--;
      m1 |= 0;
    }
    m0--;
    L1_44: for (let i2_54 = 0; i2_54 < n && i2_54 < 4; i2_54++) {
      if (i0_0 >= 1) a = a; else c = (q | c);
      c = 0.5;
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
