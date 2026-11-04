function run(s: any, list: any, n: any) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_80_1 = list.length - 1; i1_80_1 >= 0; i1_80_1--) {
    k += s.charCodeAt(i1_80_1);
    if (s.codePointAt(i1_80_1) > 100) h = g; else g = h;
    g = -g + s.charCodeAt(i1_80_1 + 1);
    let i2_95_2 = 0;
    while (i2_95_2 < s.length) {
      if (s.charCodeAt(i2_95_2) > 100) g = k; else k = g;
      let i3_59_3 = 0;
      while (i3_59_3 < list.length) {
        k = (k * 31 + list[i2_95_2]) | 0;
        i3_59_3++;
      }
      h = (h ^ k) + (list[i1_80_1] | 0);
      i2_95_2++;
    }
  }
  let i1_4_4 = 0;
  while (i1_4_4 < list.length) {
    g = g / 2 + list[i1_4_4];
    i1_4_4++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
