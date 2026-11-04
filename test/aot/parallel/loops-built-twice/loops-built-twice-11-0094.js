function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_86_1 = 0; i1_86_1 < 3; i1_86_1++) {
    h = (h * 33 ^ list[i1_86_1]) >>> 0;
    h += s.codePointAt(i1_86_1);
    for (let i2_79_2 = 3 - 1; i2_79_2 >= 0; i2_79_2--) {
      k = Math.imul(k, 16777619) ^ s.charCodeAt(i2_79_2);
      h = (h * 31 + s.codePointAt(i2_79_2)) | 0;
      for (let i3_67_3 = 0; i3_67_3 < s.length; i3_67_3++) {
        g = (g ^ k) + list[i1_86_1];
        k = k / 2 + s.codePointAt(i1_86_1);
      }
    }
  }
  for (let i1_4_4 = n - 1; i1_4_4 >= 0; i1_4_4--) {
    g = g * 2 + 1;
    for (let i2_37_5 = 0; i2_37_5 < s.length; i2_37_5++) {
      h = k - s.charCodeAt(i2_37_5 + 1);
    }
    h += s.charCodeAt(i1_4_4);
    for (let i2_93_6 = 0; i2_93_6 < list.length; i2_93_6++) {
      h = h - s.charCodeAt(i1_4_4);
      for (let i3_31_7 = 0; i3_31_7 < s.length; i3_31_7++) {
        g = (g * 33 ^ list.length) >>> 0;
        k = (k * 33 ^ s.charCodeAt(i3_31_7)) >>> 0;
      }
    }
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
