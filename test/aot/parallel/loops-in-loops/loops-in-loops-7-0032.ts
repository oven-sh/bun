let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_80 = 0, i1_81 = 0;
  i0_80 = 0;
  L0_89: while (i0_80++ < 3) {
    c = (d << 3);
    L1_27: for (let i1_59 = 0; i1_59 < 2 && i1_59 < 2; i1_59++) {
      if (m1 >= e) c = (m0 >> e); else e = (i0_80 >>> 2);
      L2_90: for (let i2_34 = 3; i2_34 > 0; i2_34--) {
        L3_23: for (let i3_86 = 0; i3_86 < p && i3_86 < 3; i3_86++) {
          m0 += 2;
          d |= 0;
          if (b !== e) continue;
        }
        L3_10: for (let i3_7 = 0; i3_7 < 4 && i3_7 < 4; i3_7++) {
          if (a < i1_59) break;
          if (e <= e) break;
          d = c;
        }
        d = (m1 * 3);
      }
    }
    const t800 = p;
  }
  i1_81 = 0;
  L0_38: do {
    if (m0 <= d) c = -0.5; else b = 2147483647;
    d = (d >>> m0);
  } while (++i1_81 < 2);
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n as number, p as number, q));
  } catch (error) {
    console.log((error as Error).name);
  }
}
