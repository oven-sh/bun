function run(s, list, n) {
  let h = 2166136261, g = 0, k = 1;
  for (let i1_16_1 = 0; i1_16_1 < list.length; i1_16_1++) {
    if (list.length > 100) h = h; else h = h;
    let i2_60_2 = 0;
    while (i2_60_2 < s.length) {
      k = k / 2 + list[i1_16_1];
      k = k / 2 + s.codePointAt(i1_16_1);
      i2_60_2++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
