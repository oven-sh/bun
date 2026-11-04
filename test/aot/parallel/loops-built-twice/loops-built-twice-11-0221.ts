function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_27_1 = 0; i1_27_1 < s.length; i1_27_1++) {
    g = (g + list[i1_27_1]) & 65535;
    for (let i2_19_2 = s.length - 1; i2_19_2 >= 0; i2_19_2--) {
      k = k / 2 + s.charCodeAt(i1_27_1 + 1);
      h += list[i1_27_1];
      g = g / 2 + s.charCodeAt(i2_19_2);
      for (let i3_45_3 = 0; i3_45_3 < s.length; i3_45_3++) {
        if (g > 1e15) g = -1;
        g = (g * 33 ^ s.charCodeAt(i2_19_2)) >>> 0;
        g = (g ^ k) + s.charCodeAt(i2_19_2 + 1);
      }
    }
    if (h > 0) h = 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
