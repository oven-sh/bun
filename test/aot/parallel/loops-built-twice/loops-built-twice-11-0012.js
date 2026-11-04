function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  for (let i1_31_1 = 0; i1_31_1 < n; i1_31_1++) {
    if (k > 0) k = 0.5;
    for (let i2_4_2 = 0; i2_4_2 < s.length; i2_4_2++) {
      h = (h % 1000003) * 31 + list[i2_4_2];
      g += s.charCodeAt(i1_31_1 + 1);
      g = g / 2 + s.length;
      for (let i3_76_3 = 0; i3_76_3 < list.length; i3_76_3++) {
        h = Math.imul(h, 16777619) ^ list.length;
        k = (k ^ h) + i1_31_1;
        h = (h % 1000003) * 31 + list[i1_31_1];
      }
    }
    g = g / 2 + list[i1_31_1];
    k = k + "" === "7" ? 0 : k + s.codePointAt(i1_31_1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
