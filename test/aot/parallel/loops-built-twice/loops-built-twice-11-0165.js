function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  for (let i1_33_1 = 0; i1_33_1 < list.length; i1_33_1++) {
    k = g - list[i1_33_1];
    k = k * 2 + 1;
    k = k * 31 + list[i1_33_1];
    for (let i2_57_2 = 0; i2_57_2 < list.length; i2_57_2++) {
      if (i2_57_2 > 100) h = h; else h = h;
      let i3_66_3 = 0;
      while (i3_66_3 < s.length) {
        g = (g ^ g) + s.charCodeAt(i2_57_2 + 1);
        i3_66_3++;
      }
      h = (h % 1000003) * 31 + s.charCodeAt(i1_33_1 + 1);
      for (let i3_95_4 = 0; i3_95_4 < list.length; i3_95_4++) {
        h = (h ^ k) + i2_57_2;
      }
      g += list.length;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
