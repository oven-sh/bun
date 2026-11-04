function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  let i1_31_1 = 0;
  while (i1_31_1 < s.length) {
    if (h > 2147483647) h = 0.5;
    g = (g << 5) - g + s.charCodeAt(i1_31_1);
    for (let i2_53_2 = list.length - 1; i2_53_2 >= 0; i2_53_2--) {
      g = (g + list[i1_31_1]) & 65535;
      let i3_64_3 = 0;
      while (i3_64_3 < n) {
        g = g / 2 + list[i3_64_3];
        k = k * 2 + 1;
        k = k * 2 + 1;
        i3_64_3++;
      }
      g = k;
    }
    k = -k + s.charCodeAt(i1_31_1);
    for (let i2_8_4 = list.length - 1; i2_8_4 >= 0; i2_8_4--) {
      g = g - s.length;
    }
    i1_31_1++;
  }
  for (let i1_99_5 = list.length - 1; i1_99_5 >= 0; i1_99_5--) {
    h = -h + s.charCodeAt(i1_99_5);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
try {
  console.log((globalThis as any).kept([104, 105], "hi", 2));
} catch (error) {
  console.log((error as Error).name);
}
