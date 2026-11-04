let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i1_12 = 0, i5_7 = 0, i4_96 = 0, i5_51 = 0, i7_18 = 0;
  L0_11: for (let i0_47 = 0; i0_47 < p && i0_47 < 4; i0_47++) {
    i1_12 = 0;
    L1_97: while (i1_12++ < 4) {
      if (p <= e) continue L1_97;
    }
    L1_68: for (let i2_2 = 0; i2_2 < 1 && i2_2 < 1; i2_2++) {
      L2_40: for (let i3_33 = 0; i3_33 < p && i3_33 < 1; i3_33++) {
        const t380 = m1;
        m1 = 4294967295;
        L3_38: for (let i4_43 = 3; i4_43 > 0; i4_43--) {
          i5_7 = 0;
          L4_45: do {
            e = null;
            a = (i5_7 & c);
            const t672 = (a + 2);
          } while (++i5_7 < 4);
        }
      }
      e = i5_7;
      if (c >= d) b = (m1 >>> a); else b = a;
      i4_96 = 0;
      L2_99: do {
        e = (i1_12 % 2);
        L3_29: for (let i5_0 = 0; i5_0 < p && i5_0 < 3; i5_0++) {
          L4_46: for (let i6_4 = 0; i6_4 < p && i6_4 < 3; i6_4++) {
            e = (i5_0 << a);
            const t993 = (e >>> a);
            m0 |= 0;
            a >>>= 0;
          }
          a = 1;
          if (i0_47 >= i5_7) continue L0_11;
          e >>>= 0;
        }
      } while (++i4_96 < 2);
    }
    if (i4_96 !== 2) break L0_11;
    a = 9007199254740991;
  }
  L0_69: for (let i3_16 = 3; i3_16 > 0; i3_16--) {
    L1_30: for (let i4_28 = 0; i4_28 < 2 && i4_28 < 2; i4_28++) {
      a = i5_7;
      m0 |= 0;
      if (e > 1) continue L1_30;
      i5_51 = 0;
      L2_5: do {
        m1 = 0;
        L3_22: for (let i6_62 = 0; i6_62 < n && i6_62 < 2; i6_62++) {
          e *= 2;
        }
        L3_76: for (let i6_49 = 0; i6_49 < n && i6_49 < 1; i6_49++) {
          i7_18 = 0;
          L4_22: while (i7_18++ < 1) {
            if (i5_51 >= q) a = i5_7; else d = -1;
          }
          a = i3_16;
          const t656 = 2147483648;
        }
      } while (++i5_51 < 1);
    }
    if (m0 == 5) continue L0_69;
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
