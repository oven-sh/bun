function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_44_1 = 0; i1_44_1 < list.length; i1_44_1++) {
    g = (g << 5) - g + s.charCodeAt(i1_44_1 + 1);
  }
  for (let i1_29_2 = s.length - 1; i1_29_2 >= 0; i1_29_2--) {
    g = (g % 1000003) * 31 + (list[i1_29_2] | 0);
    for (let i2_17_3 = 3 - 1; i2_17_3 >= 0; i2_17_3--) {
      g = (g ^ k) + (list[i2_17_3] | 0);
      for (let i3_4_4 = 0; i3_4_4 < list.length; i3_4_4++) {
        if ((list[i3_4_4] | 0) > 100) g = k; else k = g;
      }
    }
    g = (g % 1000003) * 31 + list[i1_29_2];
    for (let i2_82_5 = list.length - 1; i2_82_5 >= 0; i2_82_5--) {
      h = (h % 1000003) * 31 + s.codePointAt(i1_29_2);
      if (s.length > 100) g = k; else k = g;
      for (let i3_7_6 = 0; i3_7_6 < 3; i3_7_6++) {
        if (k > 65535) k = h;
        k = (k % 1000003) * 31 + s.charCodeAt(i1_29_2 + 1);
      }
      h = (h % 1000003) * 31 + s.charCodeAt(i2_82_5);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
