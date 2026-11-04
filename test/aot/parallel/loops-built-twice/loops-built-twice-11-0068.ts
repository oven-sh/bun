function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_59_1 = 0; i1_59_1 < s.length; i1_59_1++) {
    h = k - list[i1_59_1];
    for (let i2_19_2 = n - 1; i2_19_2 >= 0; i2_19_2--) {
      k = k * 31 + s.charCodeAt(i1_59_1);
      for (let i3_87_3 = 0; i3_87_3 < s.length; i3_87_3++) {
        g = -g + list[i1_59_1];
        if (s.length > 100) g = k; else k = g;
      }
    }
    k = g;
    if ((list[i1_59_1] | 0) > 100) h = k; else k = h;
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
