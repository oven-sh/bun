function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_99_1 = 0; i1_99_1 < s.length; i1_99_1++) {
    k = k / 2 + list[i1_99_1];
  }
  for (let i1_18_2 = 0; i1_18_2 < list.length; i1_18_2++) {
    if (list[i1_18_2] > 100) k = g; else g = k;
    let i2_65_3 = 0;
    while (i2_65_3 < list.length) {
      k = Math.imul(k, 16777619) ^ list.length;
      i2_65_3++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
