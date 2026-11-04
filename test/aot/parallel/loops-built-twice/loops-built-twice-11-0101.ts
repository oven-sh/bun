function run(s: any, list: any, n: any) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_34_1 = 0; i1_34_1 < list.length; i1_34_1++) {
    g = g * 2 + 1;
    h = h + "" === "7" ? 0 : h + list.length;
    for (let i2_68_2 = 0; i2_68_2 < 3; i2_68_2++) {
      if (s.charCodeAt(i2_68_2) > 100) g = k; else k = g;
      g += s.length;
      for (let i3_47_3 = 0; i3_47_3 < 3; i3_47_3++) {
        g = (g ^ h) + s.charCodeAt(i3_47_3);
        k = k * 2 + 1;
      }
    }
    k = (k << 5) - k + s.length;
    for (let i2_90_4 = 0; i2_90_4 < s.length; i2_90_4++) {
      k = k * 2 + 1;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
