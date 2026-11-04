function run(s: any, list: any, n: any) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_63_1 = 0; i1_63_1 < 3; i1_63_1++) {
    h = -h + s.charCodeAt(i1_63_1);
    g = -g + list[i1_63_1];
    g += s.length;
    for (let i2_48_2 = 0; i2_48_2 < list.length; i2_48_2++) {
      g = (g * 31 + list[i2_48_2]) | 0;
      let i3_53_3 = 0;
      while (i3_53_3 < 3) {
        if (k > 0) k = 0;
        i3_53_3++;
      }
    }
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
