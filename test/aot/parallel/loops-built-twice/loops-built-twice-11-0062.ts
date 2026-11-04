function run(s: string, list: any, n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_53_1 = 0; i1_53_1 < list.length; i1_53_1++) {
    if (list[i1_53_1] > 100) h = g; else g = h;
    for (let i2_8_2 = 0; i2_8_2 < s.length; i2_8_2++) {
      k = (k * 31 + i2_8_2) | 0;
      g = g * 2 + 1;
    }
    g = (g * 31 + list[i1_53_1]) | 0;
    k = k + "" === "7" ? 0 : k + list.length;
    for (let i2_53_3 = s.length - 1; i2_53_3 >= 0; i2_53_3--) {
      h = (h + i2_53_3) & 65535;
      k = (k % 1000003) * 31 + (list[i2_53_3] | 0);
      for (let i3_0_4 = 0; i3_0_4 < n; i3_0_4++) {
        h = (h * 31 + s.charCodeAt(i2_53_3)) | 0;
        if (h > 0) h = 0;
        if (s.charCodeAt(i3_0_4) > 100) g = k; else k = g;
      }
      if (list[i2_53_3] > 100) h = g; else g = h;
      for (let i3_57_5 = 0; i3_57_5 < s.length; i3_57_5++) {
        if (k > 0) k = h;
        g = (g * 31 + i3_57_5) | 0;
        k = (k % 1000003) * 31 + list[i3_57_5];
      }
    }
  }
  for (let i1_77_6 = 0; i1_77_6 < 3; i1_77_6++) {
    g = k - s.charCodeAt(i1_77_6);
    k = k * 31 + s.charCodeAt(i1_77_6);
    k = (k + s.charCodeAt(i1_77_6 + 1)) & 65535;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
