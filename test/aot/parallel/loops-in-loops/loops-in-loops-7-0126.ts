let m0: any = 0, m1: any = 1;
function run(n: number, p: number, q: any) {
  let a: any = 0, b: any = 1, c: any = p, d: any = q, e: any = 0.5;
  let i0_14 = 0, i3_9 = 0, i2_92 = 0;
  i0_14 = 0;
  L0_25: do {
    L1_51: for (let i1_33 = 0; i1_33 < p && i1_33 < 4; i1_33++) {
      d = 255;
      L2_20: for (let i2_23 = 0; i2_23 < 2 && i2_23 < 2; i2_23++) {
        if (q >= 5) e = (d | c); else b = 65536;
        c--;
      }
      L2_75: for (let i2_8 = 0; i2_8 < 4 && i2_8 < 4; i2_8++) {
        if (m1 <= d) continue L0_25;
      }
      L2_67: for (let i2_53 = 0; i2_53 < p && i2_53 < 3; i2_53++) {
        if (m0 > b) continue L0_25;
        e = 3;
        d -= 1;
        i3_9 = 0;
        L3_62: do {
          L4_94: for (let i4_55 = 3; i4_55 > 0; i4_55--) {
            const t44 = -1;
            if (m0 != i0_14) e = (b & 2); else d = c;
            c >>>= 0;
            if (i3_9 !== p) e = a; else e = i0_14;
          }
          c = (p ^ 1);
          if (q < e) b = (d ^ q); else c = 2147483648;
        } while (++i3_9 < 3);
      }
    }
    e++;
    if (p >= q) break;
  } while (++i0_14 < 4);
  i2_92 = 0;
  L0_18: while (i2_92++ < 4) {
    L1_47: for (let i3_39 = 3; i3_39 > 0; i3_39--) {
      e = 7;
      if (d >= 2) c = p; else e = d;
      if (b == 5) c = (q - d); else c = 3;
      if (i2_92 !== i3_39) b = (a * i0_14); else b = -0;
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
