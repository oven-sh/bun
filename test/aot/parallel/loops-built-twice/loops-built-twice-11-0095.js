function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_61_1 = list.length - 1; i1_61_1 >= 0; i1_61_1--) {
    g = (g * 31 + i1_61_1) | 0;
    for (let i2_81_2 = 0; i2_81_2 < list.length; i2_81_2++) {
      if (k > 0) k = h;
    }
  }
  for (let i1_68_3 = n - 1; i1_68_3 >= 0; i1_68_3--) {
    g = (g << 5) - g + s.charCodeAt(i1_68_3);
    h = (h % 1000003) * 31 + list[i1_68_3];
    if (g > 65535) g = k;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
