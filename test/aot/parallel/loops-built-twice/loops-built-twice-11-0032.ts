function run(s: any, list: any, n: any) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_49_1 = 0; i1_49_1 < list.length; i1_49_1++) {
    k = h - (list[i1_49_1] | 0);
    for (let i2_46_2 = 0; i2_46_2 < s.length; i2_46_2++) {
      h = h / 2 + list[i2_46_2];
      for (let i3_64_3 = list.length - 1; i3_64_3 >= 0; i3_64_3--) {
        if (k > 65535) k = h;
        if (s.charCodeAt(i1_49_1) > 100) k = k; else k = k;
        g = g / 2 + list[i3_64_3];
      }
    }
    k = (k << 5) - k + s.charCodeAt(i1_49_1);
  }
  for (let i1_89_4 = 0; i1_89_4 < n; i1_89_4++) {
    h = h / 2 + s.charCodeAt(i1_89_4 + 1);
    h = (h ^ g) + i1_89_4;
    h = h + "" === "7" ? 0 : h + list[i1_89_4];
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
