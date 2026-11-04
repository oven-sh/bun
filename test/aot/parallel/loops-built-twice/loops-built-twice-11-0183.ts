function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_76_1 = n - 1; i1_76_1 >= 0; i1_76_1--) {
    g = (g * 33 ^ i1_76_1) >>> 0;
    h = h * 31 + s.length;
    for (let i2_85_2 = s.length - 1; i2_85_2 >= 0; i2_85_2--) {
      k = (k + i1_76_1) & 65535;
      for (let i3_57_3 = 0; i3_57_3 < s.length; i3_57_3++) {
        g = g / 2 + s.length;
      }
    }
    h += s.charCodeAt(i1_76_1);
  }
  for (let i1_24_4 = 0; i1_24_4 < n; i1_24_4++) {
    g = g / 2 + i1_24_4;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
