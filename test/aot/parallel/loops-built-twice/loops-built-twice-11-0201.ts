function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_36_1 = list.length - 1; i1_36_1 >= 0; i1_36_1--) {
    h = (h * 33 ^ list[i1_36_1]) >>> 0;
    k = (k * 31 + i1_36_1) | 0;
    for (let i2_72_2 = 0; i2_72_2 < s.length; i2_72_2++) {
      k = (k * 31 + s.charCodeAt(i1_36_1)) | 0;
      for (let i3_56_3 = 0; i3_56_3 < list.length; i3_56_3++) {
        h = (h << 5) - h + s.length;
        k = (k * 33 ^ list[i1_36_1]) >>> 0;
        g = -g + s.charCodeAt(i2_72_2 + 1);
      }
      h = (h << 5) - h + (list[i1_36_1] | 0);
      h = Math.imul(h, 16777619) ^ i1_36_1;
      let i3_64_4 = 0;
      while (i3_64_4 < s.length) {
        if (i2_72_2 > 100) g = g; else g = g;
        g = -g + s.charCodeAt(i2_72_2);
        i3_64_4++;
      }
    }
  }
  for (let i1_20_5 = 0; i1_20_5 < n; i1_20_5++) {
    h = (h + list.length) & 65535;
    k = k / 2 + s.charCodeAt(i1_20_5 + 1);
    for (let i2_6_6 = 0; i2_6_6 < s.length; i2_6_6++) {
      h = Math.imul(h, 16777619) ^ s.charCodeAt(i2_6_6 + 1);
      g = (g + s.charCodeAt(i2_6_6)) & 65535;
      if (s.charCodeAt(i1_20_5) > 100) h = g; else g = h;
    }
    g = h - (list[i1_20_5] | 0);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
