function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_42_1 = 0;
  while (i1_42_1 < s.length) {
    k = h;
    if (g > 2147483647) g = g;
    for (let i2_61_2 = 0; i2_61_2 < n; i2_61_2++) {
      if (i1_42_1 > 100) k = g; else g = k;
      k = k - s.charCodeAt(i1_42_1);
      for (let i3_85_3 = 0; i3_85_3 < list.length; i3_85_3++) {
        g = (g % 1000003) * 31 + list[i3_85_3];
        if (k > 1e15) k = 0;
        k = (k * 31 + s.charCodeAt(i3_85_3 + 1)) | 0;
      }
      h = (h ^ g) + (list[i2_61_2] | 0);
    }
    i1_42_1++;
  }
  for (let i1_90_4 = 0; i1_90_4 < 3; i1_90_4++) {
    k = (k << 5) - k + s.charCodeAt(i1_90_4);
    g = g;
    g = (g + i1_90_4) & 65535;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
