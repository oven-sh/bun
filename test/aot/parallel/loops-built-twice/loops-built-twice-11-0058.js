function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_14_1 = 0; i1_14_1 < list.length; i1_14_1++) {
    k = Math.imul(k, 16777619) ^ s.length;
    g = g * 31 + i1_14_1;
  }
  let i1_82_2 = 0;
  while (i1_82_2 < 3) {
    if ((list[i1_82_2] | 0) > 100) g = g; else g = g;
    for (let i2_7_3 = 3 - 1; i2_7_3 >= 0; i2_7_3--) {
      k = h - s.codePointAt(i1_82_2);
    }
    k = (k % 1000003) * 31 + s.charCodeAt(i1_82_2 + 1);
    k = -k + list.length;
    i1_82_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
