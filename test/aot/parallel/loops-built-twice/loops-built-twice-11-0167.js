function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  let i1_63_1 = 0;
  while (i1_63_1 < n) {
    h = k;
    for (let i2_5_2 = 0; i2_5_2 < n; i2_5_2++) {
      g = (g * 31 + s.charCodeAt(i2_5_2)) | 0;
      k = g - list[i1_63_1];
      for (let i3_90_3 = 0; i3_90_3 < s.length; i3_90_3++) {
        g = g;
      }
      k = (k % 1000003) * 31 + (list[i2_5_2] | 0);
    }
    g += s.charCodeAt(i1_63_1 + 1);
    i1_63_1++;
  }
  for (let i1_84_4 = 0; i1_84_4 < list.length; i1_84_4++) {
    k = k * 31 + s.charCodeAt(i1_84_4);
    k = k + "" === "7" ? 0 : k + list.length;
    h = g;
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
