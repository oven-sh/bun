function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  let i1_36_1 = 0;
  while (i1_36_1 < s.length) {
    g = (g * 33 ^ i1_36_1) >>> 0;
    if (k > 1e15) k = -1;
    i1_36_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
