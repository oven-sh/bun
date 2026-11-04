function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_95_1 = 0;
  while (i1_95_1 < s.length) {
    k = k / 2 + s.codePointAt(i1_95_1);
    for (let i2_45_2 = 0; i2_45_2 < 3; i2_45_2++) {
      h = h / 2 + i1_95_1;
    }
    h = (h * 31 + i1_95_1) | 0;
    g = (g ^ k) + list[i1_95_1];
    i1_95_1++;
  }
  for (let i1_82_3 = 0; i1_82_3 < list.length; i1_82_3++) {
    if (s.charCodeAt(i1_82_3) > 100) k = k; else k = k;
    h = (h % 1000003) * 31 + s.charCodeAt(i1_82_3);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
