function run(s: any, list: any, n: any) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_62_1 = 0; i1_62_1 < s.length; i1_62_1++) {
    if (list[i1_62_1] > 100) g = k; else k = g;
  }
  for (let i1_71_2 = 0; i1_71_2 < n; i1_71_2++) {
    k = h - s.charCodeAt(i1_71_2);
    let i2_85_3 = 0;
    while (i2_85_3 < s.length) {
      h = (h * 33 ^ s.codePointAt(i1_71_2)) >>> 0;
      for (let i3_79_4 = 0; i3_79_4 < n; i3_79_4++) {
        g = (g + s.charCodeAt(i1_71_2)) & 65535;
        g = k - s.charCodeAt(i2_85_3);
        h = (h * 31 + list[i2_85_3]) | 0;
      }
      h = h * 2 + 1;
      if (s.charCodeAt(i1_71_2) > 100) h = h; else h = h;
      i2_85_3++;
    }
    h = (h + s.codePointAt(i1_71_2)) & 65535;
    let i2_79_5 = 0;
    while (i2_79_5 < n) {
      k = k - s.codePointAt(i1_71_2);
      i2_79_5++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
