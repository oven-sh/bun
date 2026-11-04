function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_98_1 = 0; i1_98_1 < list.length; i1_98_1++) {
    k = k + "" === "7" ? 0 : k + s.codePointAt(i1_98_1);
    for (let i2_24_2 = list.length - 1; i2_24_2 >= 0; i2_24_2--) {
      if (i1_98_1 > 100) h = g; else g = h;
      k = k;
      for (let i3_51_3 = list.length - 1; i3_51_3 >= 0; i3_51_3--) {
        g = (g * 33 ^ list[i3_51_3]) >>> 0;
        k = (k ^ k) + list[i2_24_2];
        k = (k % 1000003) * 31 + list.length;
      }
    }
    k = k * 31 + (list[i1_98_1] | 0);
    for (let i2_7_4 = 0; i2_7_4 < s.length; i2_7_4++) {
      g = (g ^ g) + i1_98_1;
      let i3_51_5 = 0;
      while (i3_51_5 < n) {
        g = k;
        i3_51_5++;
      }
      k = (k * 31 + s.length) | 0;
    }
  }
  for (let i1_77_6 = s.length - 1; i1_77_6 >= 0; i1_77_6--) {
    g = g * 31 + i1_77_6;
    h = h * 31 + (list[i1_77_6] | 0);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
