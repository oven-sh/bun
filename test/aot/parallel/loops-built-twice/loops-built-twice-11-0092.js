function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_15_1 = 3 - 1; i1_15_1 >= 0; i1_15_1--) {
    g = (g + s.charCodeAt(i1_15_1)) & 65535;
    k = g;
    k = (k + s.charCodeAt(i1_15_1)) & 65535;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
