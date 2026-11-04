function run(s: string, list: number[], n: number) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_2_1 = 0; i1_2_1 < list.length; i1_2_1++) {
    h = (h + s.charCodeAt(i1_2_1)) & 65535;
    for (let i2_8_2 = s.length - 1; i2_8_2 >= 0; i2_8_2--) {
      h = h - i1_2_1;
      for (let i3_1_3 = 0; i3_1_3 < n; i3_1_3++) {
        h = (h * 33 ^ list[i1_2_1]) >>> 0;
        g += (list[i1_2_1] | 0);
      }
      if (s.charCodeAt(i2_8_2 + 1) > 100) h = k; else k = h;
      let i3_78_4 = 0;
      while (i3_78_4 < list.length) {
        g = g * 2 + 1;
        g = -g + s.codePointAt(i2_8_2);
        h = (h << 5) - h + list[i1_2_1];
        i3_78_4++;
      }
      if (g > 0) g = g;
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
