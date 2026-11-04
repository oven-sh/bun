function run(s: string, list: any, n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_17_1 = 0; i1_17_1 < list.length; i1_17_1++) {
    k = (k * 31 + list[i1_17_1]) | 0;
    h += (list[i1_17_1] | 0);
    for (let i2_38_2 = s.length - 1; i2_38_2 >= 0; i2_38_2--) {
      h = h / 2 + s.codePointAt(i1_17_1);
      for (let i3_27_3 = 0; i3_27_3 < list.length; i3_27_3++) {
        g = -g + list.length;
        if (list.length > 100) h = k; else k = h;
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
