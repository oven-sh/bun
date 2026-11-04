function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_32_1 = 0; i1_32_1 < list.length; i1_32_1++) {
    g = (g % 1000003) * 31 + list[i1_32_1];
    g = g * 2 + 1;
    for (let i2_64_2 = 0; i2_64_2 < s.length; i2_64_2++) {
      k = g;
      if (s.length > 100) h = h; else h = h;
      h = (h * 33 ^ (list[i1_32_1] | 0)) >>> 0;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
