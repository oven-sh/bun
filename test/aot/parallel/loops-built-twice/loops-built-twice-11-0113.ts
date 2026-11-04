function run(s: string, list: any, n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  let i1_9_1 = 0;
  while (i1_9_1 < 3) {
    k = k * 31 + s.charCodeAt(i1_9_1);
    k = -k + s.length;
    for (let i2_32_2 = 0; i2_32_2 < 3; i2_32_2++) {
      h = g - i1_9_1;
      h = (h << 5) - h + list[i1_9_1];
      k = Math.imul(k, 16777619) ^ (list[i1_9_1] | 0);
      for (let i3_93_3 = s.length - 1; i3_93_3 >= 0; i3_93_3--) {
        if (s.length > 100) g = h; else h = g;
        g = -g + s.charCodeAt(i2_32_2 + 1);
      }
    }
    h = h * 31 + s.length;
    i1_9_1++;
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
