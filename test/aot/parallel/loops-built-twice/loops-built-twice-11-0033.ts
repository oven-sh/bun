function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_59_1 = 0; i1_59_1 < s.length; i1_59_1++) {
    h += s.charCodeAt(i1_59_1);
    h += (list[i1_59_1] | 0);
    h = (h ^ h) + s.charCodeAt(i1_59_1);
  }
  for (let i1_3_2 = 0; i1_3_2 < list.length; i1_3_2++) {
    k = (k ^ k) + s.charCodeAt(i1_3_2);
    for (let i2_33_3 = 0; i2_33_3 < n; i2_33_3++) {
      g = g;
      k = k * 31 + s.length;
      g += i2_33_3;
      for (let i3_67_4 = 0; i3_67_4 < s.length; i3_67_4++) {
        k = k / 2 + i2_33_3;
        g = (g * 31 + s.charCodeAt(i1_3_2 + 1)) | 0;
        g = -g + s.charCodeAt(i2_33_3);
      }
    }
    k = (k * 33 ^ list.length) >>> 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
