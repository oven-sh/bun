function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_98_1 = 0; i1_98_1 < 3; i1_98_1++) {
    k = g;
    k = (k + i1_98_1) & 65535;
    g = (g * 31 + s.charCodeAt(i1_98_1 + 1)) | 0;
    for (let i2_17_2 = list.length - 1; i2_17_2 >= 0; i2_17_2--) {
      if (list[i2_17_2] > 100) h = k; else k = h;
      for (let i3_81_3 = 0; i3_81_3 < list.length; i3_81_3++) {
        if (i3_81_3 > 100) g = g; else g = g;
        h = (h * 33 ^ list[i1_98_1]) >>> 0;
      }
      g += list.length;
      h = (h % 1000003) * 31 + i2_17_2;
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
