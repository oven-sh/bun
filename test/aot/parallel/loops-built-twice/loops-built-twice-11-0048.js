function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  for (let i1_69_1 = 0; i1_69_1 < s.length; i1_69_1++) {
    k = k + "" === "7" ? 0 : k + s.charCodeAt(i1_69_1);
  }
  for (let i1_41_2 = s.length - 1; i1_41_2 >= 0; i1_41_2--) {
    if (list[i1_41_2] > 100) g = g; else g = g;
    k = (k * 33 ^ s.length) >>> 0;
    for (let i2_38_3 = 0; i2_38_3 < n; i2_38_3++) {
      h = h + "" === "7" ? 0 : h + s.length;
      for (let i3_47_4 = list.length - 1; i3_47_4 >= 0; i3_47_4--) {
        k = (k * 31 + list[i2_38_3]) | 0;
      }
      h = (h * 31 + s.charCodeAt(i1_41_2)) | 0;
      k = Math.imul(k, 16777619) ^ list.length;
    }
    g = (g ^ k) + list.length;
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
