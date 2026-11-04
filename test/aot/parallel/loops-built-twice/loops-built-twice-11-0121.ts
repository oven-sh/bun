function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_62_1 = 0; i1_62_1 < n; i1_62_1++) {
    h = k;
    for (let i2_60_2 = 0; i2_60_2 < list.length; i2_60_2++) {
      g = (g << 5) - g + i2_60_2;
      let i3_85_3 = 0;
      while (i3_85_3 < s.length) {
        h = -h + (list[i2_60_2] | 0);
        k = Math.imul(k, 16777619) ^ list[i3_85_3];
        h = h + "" === "7" ? 0 : h + i1_62_1;
        i3_85_3++;
      }
      g = g - s.length;
      h = (h * 31 + (list[i1_62_1] | 0)) | 0;
    }
    h = (h * 31 + s.length) | 0;
    for (let i2_70_4 = 0; i2_70_4 < s.length; i2_70_4++) {
      g = g * 31 + list[i2_70_4];
      h = (h + s.length) & 65535;
      for (let i3_63_5 = 0; i3_63_5 < s.length; i3_63_5++) {
        g = g * 2 + 1;
      }
      k = (k * 33 ^ (list[i1_62_1] | 0)) >>> 0;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
