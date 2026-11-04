function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  let i1_22_1 = 0;
  while (i1_22_1 < list.length) {
    k = (k + s.charCodeAt(i1_22_1 + 1)) & 65535;
    for (let i2_39_2 = 0; i2_39_2 < 3; i2_39_2++) {
      h = (h * 31 + s.charCodeAt(i2_39_2)) | 0;
      let i3_90_3 = 0;
      while (i3_90_3 < n) {
        k = g - (list[i3_90_3] | 0);
        k = (k ^ h) + list[i1_22_1];
        i3_90_3++;
      }
    }
    i1_22_1++;
  }
  for (let i1_44_4 = 0; i1_44_4 < list.length; i1_44_4++) {
    h = (h % 1000003) * 31 + list.length;
    k = (k + s.codePointAt(i1_44_4)) & 65535;
    k = (k ^ k) + list[i1_44_4];
    let i2_77_5 = 0;
    while (i2_77_5 < list.length) {
      h = h * 2 + 1;
      for (let i3_72_6 = 0; i3_72_6 < list.length; i3_72_6++) {
        if (s.codePointAt(i3_72_6) > 100) h = g; else g = h;
        g = (g << 5) - g + list.length;
        h = k - s.length;
      }
      h = (h + list[i1_44_4]) & 65535;
      if (g > 0) g = 0;
      i2_77_5++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
