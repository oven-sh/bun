let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_83 = 0, i5_48 = 0;
  L0_28: for (let i0_73 = 0; i0_73 < p && i0_73 < 2; i0_73++) {
    if (p > 5) c = c; else b = (c >>> 1);
    i1_83 = 0;
    L1_5: do {
      L2_15: for (let i2_54 = 0; i2_54 < p && i2_54 < 3; i2_54++) {
        c *= 2;
        if (m0 === 2) break;
        c = (i2_54 - p);
      }
      if (c > a) b = 2147483647; else b = (i0_73 << 2);
      a -= 1;
    } while (++i1_83 < 3);
    c = c;
  }
  L0_91: for (let i1_39 = 0; i1_39 < n && i1_39 < 4; i1_39++) {
    m1 = 2147483647;
    if (b >= e) continue;
    L1_79: for (let i2_37 = 0; i2_37 < p && i2_37 < 3; i2_37++) {
      a += 2;
      L2_82: for (let i3_55 = 0; i3_55 < n && i3_55 < 4; i3_55++) {
        e += 1;
        L3_91: for (let i4_24 = 0; i4_24 < 4 && i4_24 < 4; i4_24++) {
          a--;
          i5_48 = 0;
          L4_50: do {
            a = i4_24;
            if (i2_37 == p) d = b; else d = 2;
            if (p < i2_37) b = 0; else c = null;
            a = p;
          } while (++i5_48 < 4);
        }
      }
      m1 = i2_37;
      m1 = i2_37;
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
