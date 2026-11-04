function run(s: any, list: any, n: any) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_97_1 = 0; i1_97_1 < s.length; i1_97_1++) {
    k = (k * 31 + s.length) | 0;
  }
  for (let i1_16_2 = 0; i1_16_2 < list.length; i1_16_2++) {
    if (h > 1e15) h = g;
    for (let i2_63_3 = 0; i2_63_3 < s.length; i2_63_3++) {
      k += list[i2_63_3];
    }
    g = k - s.codePointAt(i1_16_2);
    k = (k << 5) - k + list.length;
    for (let i2_97_4 = s.length - 1; i2_97_4 >= 0; i2_97_4--) {
      k = h - i2_97_4;
      g = -g + s.charCodeAt(i1_16_2);
      h = -h + i1_16_2;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
