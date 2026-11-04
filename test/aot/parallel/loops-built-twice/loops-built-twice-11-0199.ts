function run(s: any, list: any, n: any) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_37_1 = 0; i1_37_1 < list.length; i1_37_1++) {
    g = k;
    for (let i2_3_2 = 0; i2_3_2 < s.length; i2_3_2++) {
      h = (h << 5) - h + s.charCodeAt(i1_37_1);
      h = h * 31 + (list[i1_37_1] | 0);
    }
  }
  for (let i1_45_3 = n - 1; i1_45_3 >= 0; i1_45_3--) {
    k = (k ^ h) + i1_45_3;
    k = k * 31 + s.charCodeAt(i1_45_3);
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_45_3);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
