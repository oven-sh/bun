function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  let i1_48_1 = 0;
  while (i1_48_1 < n) {
    k = h - list[i1_48_1];
    i1_48_1++;
  }
  let i1_81_2 = 0;
  while (i1_81_2 < s.length) {
    g = g * 31 + list.length;
    for (let i2_13_3 = 0; i2_13_3 < list.length; i2_13_3++) {
      k = k * 2 + 1;
      for (let i3_41_4 = 3 - 1; i3_41_4 >= 0; i3_41_4--) {
        h += list.length;
      }
      k = k / 2 + list.length;
      k = (k * 31 + s.charCodeAt(i2_13_3)) | 0;
      for (let i3_39_5 = 0; i3_39_5 < 3; i3_39_5++) {
        k = k / 2 + list[i3_39_5];
      }
    }
    i1_81_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
