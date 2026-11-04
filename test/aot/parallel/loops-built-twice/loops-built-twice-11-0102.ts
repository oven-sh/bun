function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_12_1 = 0; i1_12_1 < list.length; i1_12_1++) {
    h = Math.imul(h, 16777619) ^ i1_12_1;
  }
  for (let i1_27_2 = list.length - 1; i1_27_2 >= 0; i1_27_2--) {
    if (s.charCodeAt(i1_27_2) > 100) g = k; else k = g;
    for (let i2_56_3 = 0; i2_56_3 < list.length; i2_56_3++) {
      k = Math.imul(k, 16777619) ^ i2_56_3;
      g = (g * 33 ^ s.charCodeAt(i2_56_3)) >>> 0;
      for (let i3_23_4 = 0; i3_23_4 < 3; i3_23_4++) {
        g = g + "" === "7" ? 0 : g + (list[i3_23_4] | 0);
        g = g * 31 + list[i3_23_4];
      }
    }
    h = g;
    k = k;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
