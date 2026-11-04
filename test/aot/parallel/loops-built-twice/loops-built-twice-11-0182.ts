function run(s: string, list: number[], n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_35_1 = 0; i1_35_1 < n; i1_35_1++) {
    if (list.length > 100) g = g; else g = g;
    let i2_4_2 = 0;
    while (i2_4_2 < s.length) {
      g = (g + (list[i1_35_1] | 0)) & 65535;
      g = (g * 31 + s.charCodeAt(i2_4_2)) | 0;
      i2_4_2++;
    }
    k += s.charCodeAt(i1_35_1 + 1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
