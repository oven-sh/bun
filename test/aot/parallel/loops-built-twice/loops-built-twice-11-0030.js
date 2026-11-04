function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_34_1 = s.length - 1; i1_34_1 >= 0; i1_34_1--) {
    g = (g * 33 ^ s.charCodeAt(i1_34_1)) >>> 0;
    for (let i2_78_2 = list.length - 1; i2_78_2 >= 0; i2_78_2--) {
      if (k > 65535) k = k;
      g = g + "" === "7" ? 0 : g + list[i2_78_2];
      g = Math.imul(g, 16777619) ^ s.codePointAt(i2_78_2);
      for (let i3_59_3 = 0; i3_59_3 < list.length; i3_59_3++) {
        g = (g + s.charCodeAt(i3_59_3 + 1)) & 65535;
        h += list[i2_78_2];
        g = Math.imul(g, 16777619) ^ s.charCodeAt(i3_59_3);
      }
    }
    if (k > 2147483647) k = 0;
    for (let i2_35_4 = 0; i2_35_4 < 3; i2_35_4++) {
      k = (k % 1000003) * 31 + s.charCodeAt(i1_34_1 + 1);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
