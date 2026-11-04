function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  let i1_49_1 = 0;
  while (i1_49_1 < s.length) {
    h = (h << 5) - h + list.length;
    i1_49_1++;
  }
  for (let i1_54_2 = list.length - 1; i1_54_2 >= 0; i1_54_2--) {
    h = h * 31 + s.charCodeAt(i1_54_2);
    g = -g + (list[i1_54_2] | 0);
    h = -h + list.length;
    for (let i2_84_3 = 0; i2_84_3 < list.length; i2_84_3++) {
      k = (k << 5) - k + s.charCodeAt(i2_84_3 + 1);
      for (let i3_23_4 = list.length - 1; i3_23_4 >= 0; i3_23_4--) {
        h += list.length;
      }
      h = (h * 31 + i1_54_2) | 0;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
