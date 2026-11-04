let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i3_77 = 0, i4_35 = 0;
  L0_36: for (let i0_44 = 0; i0_44 < 4 && i0_44 < 4; i0_44++) {
    L1_26: for (let i1_11 = 0; i1_11 < 3 && i1_11 < 3; i1_11++) {
      c = (c ^ q);
      d -= 1;
    }
    L1_14: for (let i1_14 = 0; i1_14 < p && i1_14 < 4; i1_14++) {
      L2_39: for (let i2_57 = 4; i2_57 > 0; i2_57--) {
        i3_77 = 0;
        L3_67: do {
          m0 = (i3_77 - 1);
          d = (i3_77 << a);
        } while (++i3_77 < 2);
        i4_35 = 0;
        L3_8: do {
          if (i3_77 > i0_44) d = (a * m0); else c = (a << e);
          a = (c + i1_14);
          L4_89: for (let i5_0 = 0; i5_0 < n && i5_0 < 1; i5_0++) {
            d = i2_57;
            d = (p << c);
            a = (i5_0 % 2);
          }
        } while (++i4_35 < 4);
      }
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
