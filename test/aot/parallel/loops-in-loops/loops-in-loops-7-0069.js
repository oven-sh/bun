let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i0_52 = 0, i3_65 = 0, i4_73 = 0, i5_87 = 0, i6_15 = 0, i6_78 = 0, i6_7 = 0;
  L0_23: for (let i0_75 = 0; i0_75 < n && i0_75 < 1; i0_75++) {
    m1 = p;
    if (c !== 2) break;
    b = (a - 3);
    L1_63: for (let i1_4 = 0; i1_4 < 4 && i1_4 < 4; i1_4++) {
      m0 = i0_75;
    }
  }
  i0_52 = 0;
  L0_11: while (i0_52++ < 3) {
    L1_86: for (let i1_63 = 0; i1_63 < n && i1_63 < 3; i1_63++) {
      L2_59: for (let i2_95 = 0; i2_95 < n && i2_95 < 4; i2_95++) {
        i3_65 = 0;
        L3_38: while (i3_65++ < 4) {
          m1 = (q & i2_95);
        }
        e = 3;
        i4_73 = 0;
        L3_87: do {
          i5_87 = 0;
          L4_99: do {
            b = (i5_87 ^ p);
            a = i4_73;
            a = (i1_63 >>> p);
            if (i2_95 > i5_87) break L0_11;
          } while (++i5_87 < 3);
          m1 >>>= 0;
          if (e !== c) continue L1_86;
          const t452 = 2147483647;
        } while (++i4_73 < 1);
        i6_15 = 0;
        L3_27: do {
          c += 1;
          b *= 2;
        } while (++i6_15 < 1);
      }
      i6_78 = 0;
      L2_50: do {
        L3_77: for (let i7_64 = 0; i7_64 < n && i7_64 < 2; i7_64++) {
          b = i3_65;
        }
        if (i4_73 !== d) e = (m0 << e); else c = (i6_15 - p);
        c = 4294967295;
      } while (++i6_78 < 3);
      const t702 = 2147483647;
    }
    i6_7 = 0;
    L1_83: do {
      const t18 = d;
      if (p === 0) break L1_83;
      c = 0;
    } while (++i6_7 < 3);
  }
  return [a, b, c, d, e, m0, m1].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
for (const [n, p, q] of [[3, 2, 1], [0, 0, "s"], [2.5, -1, undefined], [100, 2147483647, 9007199254740991]]) {
  try {
    console.log(run(n, p, q));
  } catch (error) {
    console.log(error.name);
  }
}
