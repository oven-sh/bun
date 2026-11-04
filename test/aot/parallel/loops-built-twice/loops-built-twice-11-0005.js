function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  for (let i1_80_1 = n - 1; i1_80_1 >= 0; i1_80_1--) {
    k = (k * 33 ^ s.charCodeAt(i1_80_1 + 1)) >>> 0;
    for (let i2_77_2 = 0; i2_77_2 < s.length; i2_77_2++) {
      g = k;
      if (list[i1_80_1] > 100) g = h; else h = g;
      for (let i3_68_3 = 0; i3_68_3 < 3; i3_68_3++) {
        h = (h * 31 + s.charCodeAt(i3_68_3 + 1)) | 0;
      }
      k = k * 2 + 1;
    }
    g = k;
    for (let i2_58_4 = 0; i2_58_4 < s.length; i2_58_4++) {
      g = g - list[i2_58_4];
      for (let i3_49_5 = 0; i3_49_5 < s.length; i3_49_5++) {
        g = (g * 33 ^ s.charCodeAt(i2_58_4)) >>> 0;
        g = (g * 31 + i2_58_4) | 0;
        h = (h + s.charCodeAt(i1_80_1)) & 65535;
      }
      h = h * 31 + (list[i2_58_4] | 0);
    }
    k = (k ^ k) + s.length;
  }
  for (let i1_78_6 = 0; i1_78_6 < s.length; i1_78_6++) {
    k = k + "" === "7" ? 0 : k + list[i1_78_6];
    let i2_48_7 = 0;
    while (i2_48_7 < s.length) {
      k = (k << 5) - k + s.charCodeAt(i2_48_7);
      for (let i3_68_8 = list.length - 1; i3_68_8 >= 0; i3_68_8--) {
        if (h > 2147483647) h = 0.5;
        k = (k * 31 + s.charCodeAt(i2_48_7)) | 0;
      }
      i2_48_7++;
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
