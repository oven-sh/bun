function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_48_1 = list.length - 1; i1_48_1 >= 0; i1_48_1--) {
    h = h + "" === "7" ? 0 : h + (list[i1_48_1] | 0);
  }
  for (let i1_58_2 = 0; i1_58_2 < s.length; i1_58_2++) {
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_58_2);
    for (let i2_63_3 = 0; i2_63_3 < n; i2_63_3++) {
      k = k + "" === "7" ? 0 : k + s.charCodeAt(i2_63_3 + 1);
      for (let i3_26_4 = s.length - 1; i3_26_4 >= 0; i3_26_4--) {
        h = h - list.length;
        k += i2_63_3;
      }
      k = k * 31 + s.length;
      h = (h << 5) - h + s.length;
    }
    g = k;
    g = (g % 1000003) * 31 + i1_58_2;
    for (let i2_22_5 = 0; i2_22_5 < list.length; i2_22_5++) {
      g = (g << 5) - g + list[i1_58_2];
      for (let i3_10_6 = 0; i3_10_6 < list.length; i3_10_6++) {
        k = (k * 31 + s.codePointAt(i1_58_2)) | 0;
        g = (g + list[i2_22_5]) & 65535;
        if (list.length > 100) g = g; else g = g;
      }
      h = h / 2 + s.charCodeAt(i1_58_2 + 1);
      k = k * 31 + list.length;
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
