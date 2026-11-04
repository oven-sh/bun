function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_30_1 = list.length - 1; i1_30_1 >= 0; i1_30_1--) {
    if (s.length > 100) g = g; else g = g;
    for (let i2_75_2 = list.length - 1; i2_75_2 >= 0; i2_75_2--) {
      k = k;
      for (let i3_75_3 = 0; i3_75_3 < list.length; i3_75_3++) {
        h = h - s.charCodeAt(i2_75_2 + 1);
        if (g > 65535) g = -1;
      }
      g = g * 31 + s.charCodeAt(i1_30_1 + 1);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
