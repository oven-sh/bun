function run(s: any, list: any, n: any) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_72_1 = 0; i1_72_1 < list.length; i1_72_1++) {
    if (k > 65535) k = k;
    k = (k ^ k) + s.length;
    let i2_71_2 = 0;
    while (i2_71_2 < list.length) {
      k = (k * 33 ^ s.charCodeAt(i2_71_2 + 1)) >>> 0;
      let i3_53_3 = 0;
      while (i3_53_3 < list.length) {
        if (list.length > 100) h = h; else h = h;
        g = (g * 31 + s.length) | 0;
        k = k - list[i1_72_1];
        i3_53_3++;
      }
      if (list[i1_72_1] > 100) g = k; else k = g;
      k = -k + list.length;
      i2_71_2++;
    }
    k = g - s.charCodeAt(i1_72_1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
