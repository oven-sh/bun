function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_44_1 = 0; i1_44_1 < n; i1_44_1++) {
    g = Math.imul(g, 16777619) ^ list[i1_44_1];
    k = (k << 5) - k + s.charCodeAt(i1_44_1);
  }
  let i1_9_2 = 0;
  while (i1_9_2 < s.length) {
    g += s.charCodeAt(i1_9_2);
    if (h > 2147483647) h = 0.5;
    for (let i2_8_3 = list.length - 1; i2_8_3 >= 0; i2_8_3--) {
      h = Math.imul(h, 16777619) ^ list[i1_9_2];
      k = k * 2 + 1;
      h += list[i2_8_3];
    }
    i1_9_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
