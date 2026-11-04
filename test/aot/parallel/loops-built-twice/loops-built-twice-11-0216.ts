function run(s: string, list: any, n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  let i1_98_1 = 0;
  while (i1_98_1 < s.length) {
    g = (g + s.charCodeAt(i1_98_1 + 1)) & 65535;
    if (g > 2147483647) g = -1;
    for (let i2_32_2 = 0; i2_32_2 < n; i2_32_2++) {
      g = k - s.charCodeAt(i1_98_1);
      for (let i3_14_3 = 0; i3_14_3 < list.length; i3_14_3++) {
        k = k * 2 + 1;
      }
    }
    h = (h * 33 ^ s.codePointAt(i1_98_1)) >>> 0;
    i1_98_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
