function run(s: string, list: any, n: number) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_99_1 = 0; i1_99_1 < list.length; i1_99_1++) {
    k = k * 2 + 1;
    for (let i2_14_2 = 0; i2_14_2 < n; i2_14_2++) {
      g = -g + s.charCodeAt(i1_99_1 + 1);
      for (let i3_48_3 = 0; i3_48_3 < s.length; i3_48_3++) {
        h = g - s.charCodeAt(i1_99_1);
        k = (k ^ g) + s.charCodeAt(i2_14_2);
        h = k;
      }
      h = -h + list.length;
      h = h / 2 + (list[i1_99_1] | 0);
      for (let i3_28_4 = 0; i3_28_4 < s.length; i3_28_4++) {
        k = k / 2 + (list[i3_28_4] | 0);
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
