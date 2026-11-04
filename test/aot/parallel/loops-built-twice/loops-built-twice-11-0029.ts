function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_31_1 = 3 - 1; i1_31_1 >= 0; i1_31_1--) {
    if (k > 1e15) k = k;
    for (let i2_79_2 = 0; i2_79_2 < s.length; i2_79_2++) {
      h = h / 2 + i1_31_1;
      g += s.length;
      for (let i3_27_3 = 0; i3_27_3 < 3; i3_27_3++) {
        k = (k << 5) - k + (list[i1_31_1] | 0);
      }
      h = (h << 5) - h + list[i2_79_2];
    }
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_31_1);
  }
  for (let i1_97_4 = 0; i1_97_4 < s.length; i1_97_4++) {
    h = (h % 1000003) * 31 + s.charCodeAt(i1_97_4);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
