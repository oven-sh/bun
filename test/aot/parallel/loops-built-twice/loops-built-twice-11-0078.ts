function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_89_1 = 0; i1_89_1 < s.length; i1_89_1++) {
    g = (g * 31 + s.charCodeAt(i1_89_1 + 1)) | 0;
    g = k - s.charCodeAt(i1_89_1 + 1);
  }
  let i1_53_2 = 0;
  while (i1_53_2 < s.length) {
    g = (g + s.charCodeAt(i1_53_2)) & 65535;
    for (let i2_9_3 = 0; i2_9_3 < 3; i2_9_3++) {
      h = g;
      for (let i3_42_4 = 0; i3_42_4 < 3; i3_42_4++) {
        h = (h % 1000003) * 31 + s.length;
        k = k * 31 + s.codePointAt(i2_9_3);
        if (s.charCodeAt(i3_42_4 + 1) > 100) g = k; else k = g;
      }
    }
    h = (h % 1000003) * 31 + list[i1_53_2];
    let i2_5_5 = 0;
    while (i2_5_5 < list.length) {
      h = k;
      for (let i3_67_6 = list.length - 1; i3_67_6 >= 0; i3_67_6--) {
        g = -g + list.length;
      }
      g += i1_53_2;
      for (let i3_49_7 = list.length - 1; i3_49_7 >= 0; i3_49_7--) {
        g = g;
      }
      g = g - s.length;
      i2_5_5++;
    }
    if (s.charCodeAt(i1_53_2 + 1) > 100) g = g; else g = g;
    for (let i2_46_8 = 0; i2_46_8 < n; i2_46_8++) {
      h = (h % 1000003) * 31 + s.charCodeAt(i2_46_8);
      k = (k + list[i1_53_2]) & 65535;
    }
    i1_53_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
try {
  console.log((globalThis as any).kept([104, 105], "hi", 2));
} catch (error) {
  console.log((error as Error).name);
}
