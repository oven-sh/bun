function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  for (let i1_81_1 = 0; i1_81_1 < list.length; i1_81_1++) {
    g = g * 2 + 1;
    if (list[i1_81_1] > 100) g = h; else h = g;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
