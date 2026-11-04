function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  let i1_31_1 = 0;
  while (i1_31_1 < s.length) {
    h = -h + list.length;
    for (let i2_5_2 = 0; i2_5_2 < s.length; i2_5_2++) {
      h = Math.imul(h, 16777619) ^ s.length;
      h = -h + (list[i2_5_2] | 0);
      k = k / 2 + list[i1_31_1];
    }
    i1_31_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
