function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  for (let i1_66_1 = 0; i1_66_1 < n; i1_66_1++) {
    g = (g % 1000003) * 31 + list[i1_66_1];
    for (let i2_1_2 = 0; i2_1_2 < list.length; i2_1_2++) {
      k = -k + list.length;
    }
    h = k;
    for (let i2_40_3 = 0; i2_40_3 < s.length; i2_40_3++) {
      g += s.charCodeAt(i2_40_3);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
