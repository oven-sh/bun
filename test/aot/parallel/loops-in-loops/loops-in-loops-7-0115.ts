let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i2_40 = 0, i3_5 = 0;
  L0_10: for (let i0_5 = 0; i0_5 < 3 && i0_5 < 3; i0_5++) {
    e = (p - q);
    d = d;
    if (i0_5 != b) continue L0_10;
    L1_98: for (let i1_26 = 0; i1_26 < n && i1_26 < 3; i1_26++) {
      e = 1;
      const t471 = (p | 2);
      b = m1;
      i2_40 = 0;
      L2_46: do {
        i3_5 = 0;
        L3_38: do {
          c = i3_5;
          L4_62: for (let i4_24 = 0; i4_24 < 2 && i4_24 < 2; i4_24++) {
            if (i1_26 >= c) break;
            if (q < e) a = 65536; else d = (e & a);
            e += 2;
          }
          if (e > 1) b = (d | e); else a = (e % e);
          if (i0_5 < 0) d = (b << 3); else e = (i1_26 + e);
        } while (++i3_5 < 3);
      } while (++i2_40 < 1);
    }
  }
  L0_98: for (let i2_63 = 0; i2_63 < 3 && i2_63 < 3; i2_63++) {
    L1_64: for (let i3_16 = 0; i3_16 < n && i3_16 < 3; i3_16++) {
      d = (m0 ^ d);
    }
    L1_68: for (let i3_65 = 0; i3_65 < p && i3_65 < 4; i3_65++) {
      a = i2_40;
      a = 0;
    }
    d = 4294967295;
    const t747 = i3_5;
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
