function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_74_1 = n - 1; i1_74_1 >= 0; i1_74_1--) {
    if (list[i1_74_1] > 100) g = g; else g = g;
    k = (k << 5) - k + list[i1_74_1];
    for (let i2_26_2 = 0; i2_26_2 < s.length; i2_26_2++) {
      g = (g * 33 ^ list.length) >>> 0;
      h += s.charCodeAt(i1_74_1);
      let i3_20_3 = 0;
      while (i3_20_3 < s.length) {
        k = (k ^ h) + list[i3_20_3];
        if (g > 65535) g = 0.5;
        i3_20_3++;
      }
    }
  }
  let i1_0_4 = 0;
  while (i1_0_4 < 3) {
    if (list[i1_0_4] > 100) k = h; else h = k;
    i1_0_4++;
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
