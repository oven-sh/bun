function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_53_1 = 0; i1_53_1 < s.length; i1_53_1++) {
    h = -h + list[i1_53_1];
  }
  for (let i1_37_2 = 0; i1_37_2 < list.length; i1_37_2++) {
    k = -k + list[i1_37_2];
    for (let i2_81_3 = 0; i2_81_3 < 3; i2_81_3++) {
      g = (g ^ k) + s.charCodeAt(i1_37_2);
      k = -k + list[i2_81_3];
      for (let i3_93_4 = 0; i3_93_4 < n; i3_93_4++) {
        h = (h % 1000003) * 31 + s.charCodeAt(i1_37_2 + 1);
      }
    }
    h = (h % 1000003) * 31 + (list[i1_37_2] | 0);
    k += (list[i1_37_2] | 0);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
