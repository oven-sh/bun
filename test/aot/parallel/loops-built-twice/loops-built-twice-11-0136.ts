function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_23_1 = 0; i1_23_1 < 3; i1_23_1++) {
    k = k - list.length;
    g = (g + s.charCodeAt(i1_23_1 + 1)) & 65535;
    for (let i2_57_2 = list.length - 1; i2_57_2 >= 0; i2_57_2--) {
      g = (g ^ h) + s.codePointAt(i1_23_1);
      k = (k + (list[i2_57_2] | 0)) & 65535;
      for (let i3_98_3 = 0; i3_98_3 < list.length; i3_98_3++) {
        h = (h * 31 + s.charCodeAt(i1_23_1)) | 0;
        g = (g << 5) - g + list[i3_98_3];
        h = h * 31 + s.charCodeAt(i3_98_3);
      }
    }
    g = k - s.charCodeAt(i1_23_1);
    for (let i2_36_4 = 0; i2_36_4 < n; i2_36_4++) {
      h = (h + list[i1_23_1]) & 65535;
      g = k - s.length;
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
