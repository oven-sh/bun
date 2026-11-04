function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_91_1 = 0; i1_91_1 < 3; i1_91_1++) {
    k = (k * 33 ^ s.codePointAt(i1_91_1)) >>> 0;
    let i2_91_2 = 0;
    while (i2_91_2 < s.length) {
      if (g > 65535) g = h;
      h = (h + s.charCodeAt(i2_91_2)) & 65535;
      for (let i3_54_3 = 0; i3_54_3 < s.length; i3_54_3++) {
        k = k + "" === "7" ? 0 : k + s.codePointAt(i3_54_3);
        if (list[i1_91_1] > 100) g = g; else g = g;
        g = (g * 33 ^ s.charCodeAt(i1_91_1 + 1)) >>> 0;
      }
      i2_91_2++;
    }
    g = g + "" === "7" ? 0 : g + list[i1_91_1];
  }
  for (let i1_5_4 = 0; i1_5_4 < s.length; i1_5_4++) {
    if (h > 0) h = g;
    k = k * 2 + 1;
    for (let i2_30_5 = list.length - 1; i2_30_5 >= 0; i2_30_5--) {
      g = (g << 5) - g + list.length;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
