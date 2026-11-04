function run(s, list, n) {
  let h = 2166136261, g = 0, k = 1;
  for (let i1_4_1 = 0; i1_4_1 < s.length; i1_4_1++) {
    k = (k % 1000003) * 31 + list.length;
    for (let i2_93_2 = 0; i2_93_2 < n; i2_93_2++) {
      k = h;
      k = (k + (list[i1_4_1] | 0)) & 65535;
      for (let i3_94_3 = 0; i3_94_3 < 3; i3_94_3++) {
        k += list[i2_93_2];
      }
      h += s.charCodeAt(i1_4_1);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
