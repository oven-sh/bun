function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  let i1_72_1 = 0;
  while (i1_72_1 < 3) {
    g = g * 2 + 1;
    k = (k * 33 ^ s.charCodeAt(i1_72_1)) >>> 0;
    k = g - s.length;
    i1_72_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
