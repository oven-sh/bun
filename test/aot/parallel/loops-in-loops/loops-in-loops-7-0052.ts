let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_58 = 0;
  i0_58 = 0;
  L0_87: while (i0_58++ < 3) {
    L1_72: for (let i1_24 = 0; i1_24 < 3 && i1_24 < 3; i1_24++) {
      L2_51: for (let i2_7 = 0; i2_7 < n && i2_7 < 2; i2_7++) {
        e = (e >>> b);
      }
      const t436 = (p - 3);
      a = (c ^ i0_58);
    }
    L1_97: for (let i1_43 = 0; i1_43 < 1 && i1_43 < 1; i1_43++) {
      m0 *= 2;
      L2_77: for (let i2_5 = 0; i2_5 < n && i2_5 < 3; i2_5++) {
        L3_4: for (let i3_14 = 0; i3_14 < n && i3_14 < 2; i3_14++) {
          const t21 = (i2_5 % d);
          L4_14: for (let i4_62 = 0; i4_62 < 1 && i4_62 < 1; i4_62++) {
            if (e == e) continue L4_14;
            c = (a + m0);
          }
        }
        L3_64: for (let i3_62 = 0; i3_62 < 3 && i3_62 < 3; i3_62++) {
          m1 = (i1_43 % 3);
        }
        L3_57: for (let i3_88 = 0; i3_88 < p && i3_88 < 3; i3_88++) {
          e -= 1;
        }
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
