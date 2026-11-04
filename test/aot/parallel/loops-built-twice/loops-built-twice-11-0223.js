function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  let i1_21_1 = 0;
  while (i1_21_1 < s.length) {
    k = (k << 5) - k + s.codePointAt(i1_21_1);
    if (k > 0) k = -1;
    i1_21_1++;
  }
  for (let i1_46_2 = 3 - 1; i1_46_2 >= 0; i1_46_2--) {
    h = -h + s.codePointAt(i1_46_2);
    h = h + "" === "7" ? 0 : h + s.charCodeAt(i1_46_2);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
