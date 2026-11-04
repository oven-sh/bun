function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  let i1_87_1 = 0;
  while (i1_87_1 < list.length) {
    h += s.charCodeAt(i1_87_1);
    for (let i2_20_2 = 0; i2_20_2 < s.length; i2_20_2++) {
      h = h / 2 + s.codePointAt(i2_20_2);
      g = Math.imul(g, 16777619) ^ s.codePointAt(i2_20_2);
      for (let i3_99_3 = list.length - 1; i3_99_3 >= 0; i3_99_3--) {
        h = h + "" === "7" ? 0 : h + s.charCodeAt(i1_87_1 + 1);
        k = k / 2 + s.charCodeAt(i1_87_1);
      }
      k = k * 2 + 1;
    }
    g += s.charCodeAt(i1_87_1 + 1);
    for (let i2_51_4 = 0; i2_51_4 < n; i2_51_4++) {
      g = -g + s.codePointAt(i1_87_1);
      k = g - s.length;
      h = (h + list[i1_87_1]) & 65535;
      for (let i3_95_5 = 0; i3_95_5 < 3; i3_95_5++) {
        h = (h * 33 ^ list.length) >>> 0;
        h += list[i2_51_4];
        h = k - list.length;
      }
    }
    i1_87_1++;
  }
  for (let i1_5_6 = 0; i1_5_6 < n; i1_5_6++) {
    if (g > 2147483647) g = 0;
    k = (k * 33 ^ list.length) >>> 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
try {
  console.log(globalThis.kept([104, 105], "hi", 2));
} catch (error) {
  console.log(error.name);
}
