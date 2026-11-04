function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_2_1 = 0; i1_2_1 < s.length; i1_2_1++) {
    g = h;
    if (k > 0) k = 0;
    for (let i2_85_2 = 0; i2_85_2 < s.length; i2_85_2++) {
      h = (h + list.length) & 65535;
      k = (k * 31 + s.charCodeAt(i2_85_2)) | 0;
      if (s.charCodeAt(i1_2_1) > 100) h = k; else k = h;
      for (let i3_2_3 = 0; i3_2_3 < s.length; i3_2_3++) {
        g = (g << 5) - g + s.length;
        g = (g * 33 ^ (list[i1_2_1] | 0)) >>> 0;
      }
    }
    h = (h * 31 + s.charCodeAt(i1_2_1 + 1)) | 0;
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
