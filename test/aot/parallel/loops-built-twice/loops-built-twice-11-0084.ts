function run(s: string, list: number[], n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_12_1 = 3 - 1; i1_12_1 >= 0; i1_12_1--) {
    h = (h % 1000003) * 31 + s.charCodeAt(i1_12_1 + 1);
    for (let i2_69_2 = 0; i2_69_2 < list.length; i2_69_2++) {
      h = (h + list[i1_12_1]) & 65535;
      g = k;
      for (let i3_10_3 = 0; i3_10_3 < list.length; i3_10_3++) {
        if (list[i3_10_3] > 100) g = h; else h = g;
        if (k > 1e15) k = k;
      }
      h = (h * 31 + s.charCodeAt(i2_69_2)) | 0;
      for (let i3_78_4 = 0; i3_78_4 < list.length; i3_78_4++) {
        g = Math.imul(g, 16777619) ^ s.charCodeAt(i3_78_4 + 1);
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
