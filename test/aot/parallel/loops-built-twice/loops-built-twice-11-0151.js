function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_70_1 = s.length - 1; i1_70_1 >= 0; i1_70_1--) {
    k = k + "" === "7" ? 0 : k + s.codePointAt(i1_70_1);
  }
  for (let i1_50_2 = 0; i1_50_2 < n; i1_50_2++) {
    h += (list[i1_50_2] | 0);
    for (let i2_41_3 = 0; i2_41_3 < list.length; i2_41_3++) {
      g = g + "" === "7" ? 0 : g + (list[i1_50_2] | 0);
      for (let i3_55_4 = n - 1; i3_55_4 >= 0; i3_55_4--) {
        if (s.charCodeAt(i2_41_3 + 1) > 100) k = k; else k = k;
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
