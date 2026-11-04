function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_25_1 = 0; i1_25_1 < n; i1_25_1++) {
    k = k * 31 + s.charCodeAt(i1_25_1);
    for (let i2_3_2 = 0; i2_3_2 < s.length; i2_3_2++) {
      g = h - s.charCodeAt(i2_3_2 + 1);
      k = k * 31 + s.charCodeAt(i2_3_2);
      k = k / 2 + s.length;
    }
    g += s.charCodeAt(i1_25_1 + 1);
  }
  for (let i1_98_3 = list.length - 1; i1_98_3 >= 0; i1_98_3--) {
    k = (k * 31 + i1_98_3) | 0;
    k = (k * 31 + s.charCodeAt(i1_98_3 + 1)) | 0;
    for (let i2_76_4 = n - 1; i2_76_4 >= 0; i2_76_4--) {
      k = (k % 1000003) * 31 + (list[i2_76_4] | 0);
      g = (g + s.charCodeAt(i2_76_4 + 1)) & 65535;
      g = (g ^ h) + list[i1_98_3];
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
