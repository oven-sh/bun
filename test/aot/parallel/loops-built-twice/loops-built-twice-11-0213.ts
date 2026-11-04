function run(s: any, list: any, n: any) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_91_1 = 0; i1_91_1 < s.length; i1_91_1++) {
    k = k + "" === "7" ? 0 : k + s.charCodeAt(i1_91_1 + 1);
    for (let i2_45_2 = 0; i2_45_2 < s.length; i2_45_2++) {
      h = h * 2 + 1;
      for (let i3_75_3 = 0; i3_75_3 < n; i3_75_3++) {
        g = (g ^ k) + list.length;
        h = h + "" === "7" ? 0 : h + s.charCodeAt(i1_91_1 + 1);
      }
    }
    g = (g % 1000003) * 31 + (list[i1_91_1] | 0);
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_91_1 + 1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
