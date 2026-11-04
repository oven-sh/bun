function run(s: any, list: any, n: any) {
  let h: any = 1, g: any = 0, k: any = 1;
  let i1_27_1 = 0;
  while (i1_27_1 < s.length) {
    h = Math.imul(h, 16777619) ^ list[i1_27_1];
    k = k / 2 + s.length;
    for (let i2_68_2 = 0; i2_68_2 < list.length; i2_68_2++) {
      k = k * 2 + 1;
      for (let i3_35_3 = 0; i3_35_3 < n; i3_35_3++) {
        k = k * 2 + 1;
        if (list.length > 100) h = g; else g = h;
      }
      g = -g + list[i2_68_2];
      let i3_70_4 = 0;
      while (i3_70_4 < s.length) {
        h = g - s.charCodeAt(i3_70_4);
        g = (g + list[i2_68_2]) & 65535;
        g = g + "" === "7" ? 0 : g + list[i1_27_1];
        i3_70_4++;
      }
    }
    h += list.length;
    i1_27_1++;
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
