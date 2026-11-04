function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_17_1 = 0; i1_17_1 < list.length; i1_17_1++) {
    h = (h ^ h) + list[i1_17_1];
    for (let i2_37_2 = s.length - 1; i2_37_2 >= 0; i2_37_2--) {
      g = g * 31 + s.charCodeAt(i2_37_2);
      k = (k ^ h) + list[i2_37_2];
      g = -g + list.length;
    }
    k = k * 2 + 1;
    for (let i2_89_3 = 0; i2_89_3 < list.length; i2_89_3++) {
      if (s.codePointAt(i2_89_3) > 100) k = h; else h = k;
      if (s.charCodeAt(i2_89_3) > 100) k = h; else h = k;
      for (let i3_21_4 = list.length - 1; i3_21_4 >= 0; i3_21_4--) {
        g = k - list[i2_89_3];
        if (g > 1e15) g = 0.5;
      }
      h = (h * 33 ^ list[i1_17_1]) >>> 0;
      let i3_43_5 = 0;
      while (i3_43_5 < s.length) {
        k = (k * 31 + (list[i3_43_5] | 0)) | 0;
        h = (h * 33 ^ s.charCodeAt(i3_43_5)) >>> 0;
        k = (k % 1000003) * 31 + s.charCodeAt(i3_43_5);
        i3_43_5++;
      }
    }
    h = (h * 31 + list.length) | 0;
  }
  let i1_18_6 = 0;
  while (i1_18_6 < s.length) {
    k = k * 2 + 1;
    i1_18_6++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
