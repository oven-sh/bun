function run(s: string, list: any, n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_27_1 = 0; i1_27_1 < n; i1_27_1++) {
    g = (g * 31 + list[i1_27_1]) | 0;
    for (let i2_51_2 = 0; i2_51_2 < s.length; i2_51_2++) {
      h = (h ^ h) + s.codePointAt(i2_51_2);
      for (let i3_25_3 = 0; i3_25_3 < list.length; i3_25_3++) {
        h = (h * 33 ^ s.codePointAt(i2_51_2)) >>> 0;
        k = k * 31 + s.charCodeAt(i2_51_2);
        h = k - list[i1_27_1];
      }
      h = Math.imul(h, 16777619) ^ list[i2_51_2];
      for (let i3_77_4 = 0; i3_77_4 < n; i3_77_4++) {
        g = g / 2 + list[i3_77_4];
      }
    }
    g = (g << 5) - g + (list[i1_27_1] | 0);
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
