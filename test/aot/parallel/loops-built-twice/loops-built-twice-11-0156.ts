function run(s: any, list: any, n: any) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  let i1_41_1 = 0;
  while (i1_41_1 < list.length) {
    g = -g + s.charCodeAt(i1_41_1 + 1);
    for (let i2_57_2 = 0; i2_57_2 < s.length; i2_57_2++) {
      k = (k << 5) - k + s.charCodeAt(i2_57_2);
      for (let i3_27_3 = 0; i3_27_3 < s.length; i3_27_3++) {
        if (g > 2147483647) g = -1;
        g = (g * 33 ^ (list[i2_57_2] | 0)) >>> 0;
      }
    }
    g = k - s.codePointAt(i1_41_1);
    g = g * 31 + s.charCodeAt(i1_41_1);
    i1_41_1++;
  }
  for (let i1_27_4 = 0; i1_27_4 < 3; i1_27_4++) {
    k = k * 2 + 1;
    k = (k * 31 + s.codePointAt(i1_27_4)) | 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
