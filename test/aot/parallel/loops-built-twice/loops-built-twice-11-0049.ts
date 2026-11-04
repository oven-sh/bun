function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_19_1 = 0; i1_19_1 < 3; i1_19_1++) {
    h = h / 2 + s.codePointAt(i1_19_1);
    h = (h * 33 ^ list[i1_19_1]) >>> 0;
    for (let i2_91_2 = 0; i2_91_2 < 3; i2_91_2++) {
      k = Math.imul(k, 16777619) ^ s.codePointAt(i1_19_1);
      let i3_45_3 = 0;
      while (i3_45_3 < list.length) {
        h = h * 2 + 1;
        k = (k ^ h) + list.length;
        k = (k * 31 + list.length) | 0;
        i3_45_3++;
      }
      g = g / 2 + s.length;
      g = (g % 1000003) * 31 + s.charCodeAt(i1_19_1);
    }
  }
  let i1_24_4 = 0;
  while (i1_24_4 < list.length) {
    k = k;
    g = (g * 31 + (list[i1_24_4] | 0)) | 0;
    for (let i2_50_5 = 0; i2_50_5 < s.length; i2_50_5++) {
      g = g / 2 + list[i2_50_5];
      h = h * 31 + (list[i2_50_5] | 0);
      let i3_68_6 = 0;
      while (i3_68_6 < list.length) {
        k = k * 31 + s.charCodeAt(i3_68_6);
        if (list[i3_68_6] > 100) h = h; else h = h;
        i3_68_6++;
      }
      k = k * 31 + s.codePointAt(i2_50_5);
    }
    k = (k * 31 + list[i1_24_4]) | 0;
    for (let i2_92_7 = 0; i2_92_7 < 3; i2_92_7++) {
      h = (h << 5) - h + list.length;
      for (let i3_92_8 = 0; i3_92_8 < s.length; i3_92_8++) {
        h = (h << 5) - h + list[i2_92_7];
      }
      k += s.length;
      k = (k << 5) - k + i1_24_4;
    }
    i1_24_4++;
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
