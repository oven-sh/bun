function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_9_1 = 0; i1_9_1 < list.length; i1_9_1++) {
    k = k - (list[i1_9_1] | 0);
    for (let i2_26_2 = 0; i2_26_2 < s.length; i2_26_2++) {
      k += list[i1_9_1];
      g = g / 2 + list.length;
      for (let i3_89_3 = 0; i3_89_3 < s.length; i3_89_3++) {
        g = (g << 5) - g + list.length;
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
