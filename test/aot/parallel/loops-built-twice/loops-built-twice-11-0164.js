function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  let i1_54_1 = 0;
  while (i1_54_1 < list.length) {
    if (h > 0) h = 0.5;
    g = k - s.codePointAt(i1_54_1);
    for (let i2_40_2 = 0; i2_40_2 < s.length; i2_40_2++) {
      g = h - list[i2_40_2];
      let i3_51_3 = 0;
      while (i3_51_3 < s.length) {
        g = (g * 31 + list.length) | 0;
        g = k - s.charCodeAt(i2_40_2);
        i3_51_3++;
      }
      g = g + "" === "7" ? 0 : g + s.charCodeAt(i1_54_1);
      k = (k << 5) - k + list.length;
    }
    k = k + "" === "7" ? 0 : k + s.charCodeAt(i1_54_1 + 1);
    for (let i2_78_4 = 3 - 1; i2_78_4 >= 0; i2_78_4--) {
      g = (g % 1000003) * 31 + s.charCodeAt(i1_54_1 + 1);
      for (let i3_9_5 = s.length - 1; i3_9_5 >= 0; i3_9_5--) {
        k = k + "" === "7" ? 0 : k + s.codePointAt(i1_54_1);
        k = (k + s.length) & 65535;
        h = h * 31 + list.length;
      }
      if (h > 1e15) h = h;
      for (let i3_82_6 = 0; i3_82_6 < s.length; i3_82_6++) {
        h += s.length;
      }
    }
    i1_54_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
