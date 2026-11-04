function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  let i1_77_1 = 0;
  while (i1_77_1 < s.length) {
    if (g > 1e15) g = 0;
    for (let i2_81_2 = 0; i2_81_2 < n; i2_81_2++) {
      k = k + "" === "7" ? 0 : k + i1_77_1;
      for (let i3_0_3 = 0; i3_0_3 < list.length; i3_0_3++) {
        h = h;
      }
    }
    i1_77_1++;
  }
  for (let i1_37_4 = 0; i1_37_4 < n; i1_37_4++) {
    h = h * 2 + 1;
    for (let i2_37_5 = 0; i2_37_5 < s.length; i2_37_5++) {
      k += list.length;
      k = (k % 1000003) * 31 + s.codePointAt(i2_37_5);
      g = (g * 33 ^ s.charCodeAt(i1_37_4 + 1)) >>> 0;
    }
    h = h * 2 + 1;
    g = h - list.length;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
