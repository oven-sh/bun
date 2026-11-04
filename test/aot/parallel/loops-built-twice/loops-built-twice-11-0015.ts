function run(s: any, list: any, n: any) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_42_1 = 0; i1_42_1 < s.length; i1_42_1++) {
    if (g > 2147483647) g = 0;
    let i2_28_2 = 0;
    while (i2_28_2 < list.length) {
      g = (g % 1000003) * 31 + list.length;
      k = (k * 31 + s.charCodeAt(i1_42_1)) | 0;
      i2_28_2++;
    }
    g += s.charCodeAt(i1_42_1);
    h = Math.imul(h, 16777619) ^ list[i1_42_1];
    for (let i2_54_3 = 0; i2_54_3 < n; i2_54_3++) {
      g = (g << 5) - g + s.charCodeAt(i1_42_1);
      h += s.charCodeAt(i2_54_3 + 1);
      let i3_45_4 = 0;
      while (i3_45_4 < s.length) {
        k = (k << 5) - k + s.codePointAt(i3_45_4);
        i3_45_4++;
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
