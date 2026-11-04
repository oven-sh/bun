function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_5_1 = n - 1; i1_5_1 >= 0; i1_5_1--) {
    h = h + "" === "7" ? 0 : h + (list[i1_5_1] | 0);
    for (let i2_72_2 = 0; i2_72_2 < n; i2_72_2++) {
      if (list[i1_5_1] > 100) h = h; else h = h;
      g = g * 31 + (list[i2_72_2] | 0);
      k = (k + s.charCodeAt(i1_5_1)) & 65535;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
