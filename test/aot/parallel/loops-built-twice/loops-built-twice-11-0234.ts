function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_50_1 = 0;
  while (i1_50_1 < s.length) {
    if (h > 0) h = -1;
    g = (g + s.codePointAt(i1_50_1)) & 65535;
    g = h - list[i1_50_1];
    i1_50_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
