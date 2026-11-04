function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_63_1 = 3 - 1; i1_63_1 >= 0; i1_63_1--) {
    k = (k % 1000003) * 31 + s.charCodeAt(i1_63_1);
  }
  let i1_29_2 = 0;
  while (i1_29_2 < s.length) {
    k = (k << 5) - k + list.length;
    for (let i2_34_3 = 0; i2_34_3 < 3; i2_34_3++) {
      h = (h * 33 ^ s.length) >>> 0;
      h += s.charCodeAt(i2_34_3 + 1);
    }
    i1_29_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
