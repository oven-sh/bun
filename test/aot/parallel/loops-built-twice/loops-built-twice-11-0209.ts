function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_78_1 = 0; i1_78_1 < n; i1_78_1++) {
    k = k - list.length;
    for (let i2_75_2 = 0; i2_75_2 < list.length; i2_75_2++) {
      h = h + "" === "7" ? 0 : h + list.length;
      for (let i3_20_3 = 0; i3_20_3 < s.length; i3_20_3++) {
        g = (g * 33 ^ s.charCodeAt(i2_75_2)) >>> 0;
      }
    }
    h = (h % 1000003) * 31 + i1_78_1;
    k = g - s.length;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
