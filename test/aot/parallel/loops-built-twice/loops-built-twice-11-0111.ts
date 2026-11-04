function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_91_1 = 0; i1_91_1 < n; i1_91_1++) {
    if (h > 1e15) h = -1;
  }
  for (let i1_50_2 = 0; i1_50_2 < n; i1_50_2++) {
    if (k > 65535) k = 0.5;
    for (let i2_79_3 = 0; i2_79_3 < 3; i2_79_3++) {
      h = h * 2 + 1;
    }
    h = (h << 5) - h + i1_50_2;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
