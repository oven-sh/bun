function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_36_1 = 0;
  while (i1_36_1 < 3) {
    if (h > 65535) h = h;
    let i2_76_2 = 0;
    while (i2_76_2 < n) {
      h = (h % 1000003) * 31 + list[i2_76_2];
      i2_76_2++;
    }
    i1_36_1++;
  }
  for (let i1_9_3 = s.length - 1; i1_9_3 >= 0; i1_9_3--) {
    h = k;
    k = (k + list.length) & 65535;
    g = (g % 1000003) * 31 + s.length;
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
