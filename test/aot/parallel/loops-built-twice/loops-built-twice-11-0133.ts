function run(s: any, list: any, n: any) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_67_1 = 0; i1_67_1 < list.length; i1_67_1++) {
    g = (g ^ h) + list[i1_67_1];
    for (let i2_92_2 = 0; i2_92_2 < list.length; i2_92_2++) {
      k = (k * 31 + list.length) | 0;
      g = g * 31 + i2_92_2;
      let i3_90_3 = 0;
      while (i3_90_3 < n) {
        g = g * 2 + 1;
        g = h;
        i3_90_3++;
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
