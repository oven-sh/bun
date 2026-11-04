function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_65_1 = 0; i1_65_1 < s.length; i1_65_1++) {
    k = k * 2 + 1;
    k = h;
    g = g - i1_65_1;
    for (let i2_62_2 = 0; i2_62_2 < s.length; i2_62_2++) {
      if (list[i1_65_1] > 100) g = g; else g = g;
      h = h * 31 + s.codePointAt(i1_65_1);
    }
  }
  for (let i1_2_3 = s.length - 1; i1_2_3 >= 0; i1_2_3--) {
    h = h / 2 + s.codePointAt(i1_2_3);
    k = Math.imul(k, 16777619) ^ list[i1_2_3];
    for (let i2_93_4 = s.length - 1; i2_93_4 >= 0; i2_93_4--) {
      g = (g * 31 + (list[i2_93_4] | 0)) | 0;
      h = (h + s.charCodeAt(i2_93_4)) & 65535;
    }
    h = -h + list.length;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
