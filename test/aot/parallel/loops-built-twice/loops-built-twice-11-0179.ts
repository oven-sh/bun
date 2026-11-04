function run(s: string, list: number[], n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_65_1 = 0; i1_65_1 < list.length; i1_65_1++) {
    if (s.codePointAt(i1_65_1) > 100) h = g; else g = h;
    let i2_18_2 = 0;
    while (i2_18_2 < s.length) {
      g = g + "" === "7" ? 0 : g + i1_65_1;
      if (k > 2147483647) k = 0;
      g = Math.imul(g, 16777619) ^ i1_65_1;
      for (let i3_47_3 = s.length - 1; i3_47_3 >= 0; i3_47_3--) {
        k = Math.imul(k, 16777619) ^ list[i3_47_3];
      }
      i2_18_2++;
    }
    g = (g << 5) - g + list[i1_65_1];
    for (let i2_64_4 = 0; i2_64_4 < s.length; i2_64_4++) {
      k = (k + list[i1_65_1]) & 65535;
      k = -k + (list[i2_64_4] | 0);
      for (let i3_71_5 = 0; i3_71_5 < s.length; i3_71_5++) {
        g = (g ^ k) + list[i1_65_1];
        if (s.codePointAt(i3_71_5) > 100) g = k; else k = g;
        h = (h % 1000003) * 31 + list[i2_64_4];
      }
      if ((list[i2_64_4] | 0) > 100) h = k; else k = h;
    }
    k = (k ^ g) + s.length;
    let i2_95_6 = 0;
    while (i2_95_6 < 3) {
      g = h;
      i2_95_6++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
