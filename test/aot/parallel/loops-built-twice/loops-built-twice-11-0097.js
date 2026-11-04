function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  for (let i1_59_1 = 0; i1_59_1 < s.length; i1_59_1++) {
    h = h;
    for (let i2_79_2 = 0; i2_79_2 < s.length; i2_79_2++) {
      if (g > 65535) g = g;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
