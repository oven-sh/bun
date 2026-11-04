function run(s: any, list: any, n: any) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_71_1 = 0; i1_71_1 < list.length; i1_71_1++) {
    k = k / 2 + s.charCodeAt(i1_71_1);
    for (let i2_73_2 = 0; i2_73_2 < list.length; i2_73_2++) {
      g = (g ^ h) + i1_71_1;
    }
    if (k > 2147483647) k = -1;
    k = Math.imul(k, 16777619) ^ s.charCodeAt(i1_71_1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
