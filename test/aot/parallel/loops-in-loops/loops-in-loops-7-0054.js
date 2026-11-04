let m0 = 0, m1 = 1;
function run(n, p, q) {
  let a = 0, b = 1, c = p, d = q, e = 0.5;
  let i2_85 = 0;
  L0_9: for (let i0_87 = 0; i0_87 < p && i0_87 < 3; i0_87++) {
    if (d !== 5) e = (a ^ 2); else c = (p >>> i0_87);
    L1_44: for (let i1_30 = 0; i1_30 < 2 && i1_30 < 2; i1_30++) {
      i2_85 = 0;
      L2_58: do {
        if (e > c) break L1_44;
        const t258 = (p << 3);
        L3_24: for (let i3_9 = 0; i3_9 < p && i3_9 < 4; i3_9++) {
          c >>>= 0;
          m1 |= 0;
        }
        L3_62: for (let i3_8 = 0; i3_8 < n && i3_8 < 3; i3_8++) {
          if (q > i3_8) b = (a | q); else d = m0;
          e = (d | b);
          L4_6: for (let i4_76 = 0; i4_76 < p && i4_76 < 1; i4_76++) {
            const t5 = i3_8;
            if (a !== a) break;
            m1++;
          }
        }
      } while (++i2_85 < 3);
    }
    if (i2_85 !== i0_87) break;
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
