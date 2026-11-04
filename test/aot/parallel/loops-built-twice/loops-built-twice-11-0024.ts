function run(s: string, list: any, n: number) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_53_1 = 0; i1_53_1 < s.length; i1_53_1++) {
    g = g * 2 + 1;
    g = g / 2 + list.length;
    for (let i2_30_2 = 0; i2_30_2 < 3; i2_30_2++) {
      g = g * 2 + 1;
    }
    g = (g * 33 ^ s.codePointAt(i1_53_1)) >>> 0;
    for (let i2_65_3 = 0; i2_65_3 < n; i2_65_3++) {
      g = g + "" === "7" ? 0 : g + i1_53_1;
    }
  }
  for (let i1_33_4 = list.length - 1; i1_33_4 >= 0; i1_33_4--) {
    h = (h + s.length) & 65535;
    h = h - s.length;
    for (let i2_3_5 = 3 - 1; i2_3_5 >= 0; i2_3_5--) {
      k += s.charCodeAt(i1_33_4);
      h += s.length;
      g = g * 2 + 1;
      for (let i3_51_6 = s.length - 1; i3_51_6 >= 0; i3_51_6--) {
        if (k > 65535) k = 0.5;
      }
    }
    g = k;
    for (let i2_8_7 = 0; i2_8_7 < list.length; i2_8_7++) {
      g = g * 2 + 1;
      for (let i3_4_8 = 0; i3_4_8 < list.length; i3_4_8++) {
        g = Math.imul(g, 16777619) ^ list[i3_4_8];
        if (h > 65535) h = 0;
      }
    }
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
