function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  let i1_89_1 = 0;
  while (i1_89_1 < s.length) {
    k = Math.imul(k, 16777619) ^ s.codePointAt(i1_89_1);
    h = (h + list.length) & 65535;
    for (let i2_6_2 = 0; i2_6_2 < s.length; i2_6_2++) {
      g = g * 2 + 1;
      for (let i3_11_3 = 0; i3_11_3 < n; i3_11_3++) {
        k = g;
        k = (k + list[i3_11_3]) & 65535;
        if (k > 1e15) k = -1;
      }
      if (k > 0) k = 0.5;
      for (let i3_63_4 = 0; i3_63_4 < s.length; i3_63_4++) {
        g = (g % 1000003) * 31 + list[i1_89_1];
        k = k - s.codePointAt(i1_89_1);
      }
      h = (h * 31 + (list[i2_6_2] | 0)) | 0;
      let i3_9_5 = 0;
      while (i3_9_5 < 3) {
        g = g + "" === "7" ? 0 : g + s.codePointAt(i3_9_5);
        g = k;
        h = Math.imul(h, 16777619) ^ s.charCodeAt(i3_9_5 + 1);
        i3_9_5++;
      }
    }
    i1_89_1++;
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
