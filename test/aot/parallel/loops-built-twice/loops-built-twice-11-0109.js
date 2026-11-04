function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_33_1 = s.length - 1; i1_33_1 >= 0; i1_33_1--) {
    h = h * 2 + 1;
    h = h + "" === "7" ? 0 : h + list.length;
    for (let i2_68_2 = 0; i2_68_2 < n; i2_68_2++) {
      g = g / 2 + list[i2_68_2];
      for (let i3_81_3 = 0; i3_81_3 < 3; i3_81_3++) {
        k = k;
        k = g - (list[i2_68_2] | 0);
        k = Math.imul(k, 16777619) ^ s.charCodeAt(i3_81_3);
      }
      g = g;
      for (let i3_76_4 = 0; i3_76_4 < list.length; i3_76_4++) {
        if (h > 0) h = -1;
      }
    }
    k = (k << 5) - k + list.length;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
