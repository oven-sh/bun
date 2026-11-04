let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_44 = 0;
  L0_94: for (let i0_4 = 3; i0_4 > 0; i0_4--) {
    b += 2;
    b = m1;
    i1_44 = 0;
    L1_97: while (i1_44++ < 2) {
      L2_24: for (let i2_8 = 0; i2_8 < p && i2_8 < 3; i2_8++) {
        if (p <= p) d = i0_4; else a = q;
        L3_92: for (let i3_80 = 0; i3_80 < n && i3_80 < 3; i3_80++) {
          if (d === i1_44) continue L3_92;
          if (p == c) break L0_94;
        }
        if (q == p) continue L0_94;
      }
      m0 -= 1;
      if (a != i1_44) c = 0; else c = c;
      if (m0 >= p) continue;
    }
  }
  L0_23: for (let i1_76 = 0; i1_76 < n && i1_76 < 2; i1_76++) {
    c = d;
    if (c == p) break L0_23;
    L1_12: for (let i2_18 = 0; i2_18 < p && i2_18 < 3; i2_18++) {
      d = (q & p);
      const t574 = p;
      L2_1: for (let i3_93 = 0; i3_93 < 2 && i3_93 < 2; i3_93++) {
        L3_33: for (let i4_55 = 0; i4_55 < p && i4_55 < 3; i4_55++) {
          e = (c & i1_76);
          m0 *= 2;
          e += 1;
        }
        a >>>= 0;
        if (i1_44 < m1) d = (i3_93 & i1_44); else d = 2;
      }
      c = "x";
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
