let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_57 = 0, i1_71 = 0, i3_78 = 0, i3_43 = 0;
  i0_57 = 0;
  L0_56: while (i0_57++ < 1) {
    if (p > 5) break;
    i1_71 = 0;
    L1_66: do {
      const t160 = (m1 + 2);
      L2_65: for (let i2_89 = 0; i2_89 < n && i2_89 < 1; i2_89++) {
        if (q == p) continue L2_65;
        i3_78 = 0;
        L3_20: do {
          b = (a % m1);
          m1 += 2;
        } while (++i3_78 < 3);
      }
    } while (++i1_71 < 2);
    i3_43 = 0;
    L1_20: while (i3_43++ < 4) {
      L2_62: for (let i4_10 = 0; i4_10 < n && i4_10 < 1; i4_10++) {
        if (e == a) break L2_62;
      }
      L2_48: for (let i4_13 = 0; i4_13 < p && i4_13 < 3; i4_13++) {
        m0 += 2;
        d = (a - 2);
        L3_27: for (let i5_38 = 1; i5_38 > 0; i5_38--) {
          c = i3_43;
          L4_54: for (let i6_67 = 4; i6_67 > 0; i6_67--) {
            if (i5_38 == q) a = e; else c = e;
            m1 |= 0;
            c = (p + q);
          }
          a = (d + q);
        }
        if (m1 <= i4_13) continue L2_48;
      }
      b = (m1 - i0_57);
      L2_43: for (let i4_33 = 0; i4_33 < 2 && i4_33 < 2; i4_33++) {
        L3_32: for (let i5_28 = 0; i5_28 < 3 && i5_28 < 3; i5_28++) {
          L4_38: for (let i6_78 = 1; i6_78 > 0; i6_78--) {
            if (p >= d) d = (b ^ m0); else b = (i1_71 >>> i3_43);
            m0 = i5_28;
            b += 1;
            d = 7;
          }
          if (b != 5) continue L1_20;
        }
        a *= 2;
        a += 1;
        if (e !== p) e = -1; else a = i3_78;
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
