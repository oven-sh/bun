function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_39_1 = s.length - 1; i1_39_1 >= 0; i1_39_1--) {
    g = (g * 31 + list[i1_39_1]) | 0;
    for (let i2_18_2 = 0; i2_18_2 < 3; i2_18_2++) {
      h = h;
      for (let i3_11_3 = list.length - 1; i3_11_3 >= 0; i3_11_3--) {
        h = k - list[i3_11_3];
        g = (g % 1000003) * 31 + s.length;
      }
      h += list[i2_18_2];
      for (let i3_85_4 = 0; i3_85_4 < n; i3_85_4++) {
        k = k * 31 + s.charCodeAt(i2_18_2);
        if (list.length > 100) g = k; else k = g;
      }
    }
    k = (k ^ g) + list.length;
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
