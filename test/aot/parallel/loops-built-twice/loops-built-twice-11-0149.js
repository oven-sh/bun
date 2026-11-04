function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_76_1 = 0; i1_76_1 < 3; i1_76_1++) {
    g = (g + s.charCodeAt(i1_76_1)) & 65535;
    k += (list[i1_76_1] | 0);
    h = (h % 1000003) * 31 + s.charCodeAt(i1_76_1);
  }
  for (let i1_41_2 = 0; i1_41_2 < 3; i1_41_2++) {
    g = (g % 1000003) * 31 + s.charCodeAt(i1_41_2);
    for (let i2_10_3 = 0; i2_10_3 < list.length; i2_10_3++) {
      k = k * 2 + 1;
      for (let i3_72_4 = 0; i3_72_4 < s.length; i3_72_4++) {
        k = Math.imul(k, 16777619) ^ s.charCodeAt(i3_72_4);
        h = (h % 1000003) * 31 + list.length;
        h = (h ^ k) + s.length;
      }
      if (k > 65535) k = 0.5;
    }
    if (g > 2147483647) g = 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
