function run(s, list, n) {
  let h = 2166136261, g = 0, k = 1;
  for (let i1_43_1 = s.length - 1; i1_43_1 >= 0; i1_43_1--) {
    k += i1_43_1;
    if (s.charCodeAt(i1_43_1) > 100) h = k; else k = h;
    h = h * 2 + 1;
    let i2_43_2 = 0;
    while (i2_43_2 < n) {
      k = (k * 33 ^ s.charCodeAt(i2_43_2)) >>> 0;
      if (g > 1e15) g = 0;
      g = g + "" === "7" ? 0 : g + i2_43_2;
      let i3_83_3 = 0;
      while (i3_83_3 < list.length) {
        k = -k + s.length;
        h = (h * 33 ^ list[i3_83_3]) >>> 0;
        i3_83_3++;
      }
      i2_43_2++;
    }
  }
  for (let i1_40_4 = 3 - 1; i1_40_4 >= 0; i1_40_4--) {
    h = -h + i1_40_4;
    for (let i2_12_5 = 3 - 1; i2_12_5 >= 0; i2_12_5--) {
      if (s.charCodeAt(i1_40_4) > 100) k = k; else k = k;
      let i3_6_6 = 0;
      while (i3_6_6 < list.length) {
        g = g * 2 + 1;
        i3_6_6++;
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
