function run(s: any, list: any, n: any) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_41_1 = 0; i1_41_1 < n; i1_41_1++) {
    g = g;
    for (let i2_89_2 = list.length - 1; i2_89_2 >= 0; i2_89_2--) {
      k = g - s.charCodeAt(i2_89_2);
      for (let i3_20_3 = 0; i3_20_3 < 3; i3_20_3++) {
        k = k / 2 + i3_20_3;
        h = (h % 1000003) * 31 + i3_20_3;
      }
      k = k * 2 + 1;
    }
  }
  for (let i1_32_4 = 0; i1_32_4 < list.length; i1_32_4++) {
    g = g + "" === "7" ? 0 : g + s.charCodeAt(i1_32_4);
    h = h + "" === "7" ? 0 : h + list[i1_32_4];
    k = Math.imul(k, 16777619) ^ s.codePointAt(i1_32_4);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
