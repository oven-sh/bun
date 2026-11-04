function run(s: any, list: any, n: any) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_77_1 = 0; i1_77_1 < list.length; i1_77_1++) {
    g = g * 31 + s.codePointAt(i1_77_1);
  }
  for (let i1_39_2 = 0; i1_39_2 < list.length; i1_39_2++) {
    if (list[i1_39_2] > 100) g = g; else g = g;
    for (let i2_75_3 = n - 1; i2_75_3 >= 0; i2_75_3--) {
      g = (g + list.length) & 65535;
      for (let i3_90_4 = 0; i3_90_4 < s.length; i3_90_4++) {
        h = (h ^ h) + (list[i1_39_2] | 0);
      }
    }
    h += s.codePointAt(i1_39_2);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
