function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_66_1 = 0; i1_66_1 < list.length; i1_66_1++) {
    h = g - list[i1_66_1];
    k = g;
    k = (k * 31 + i1_66_1) | 0;
    for (let i2_62_2 = list.length - 1; i2_62_2 >= 0; i2_62_2--) {
      h = h / 2 + s.length;
      g = Math.imul(g, 16777619) ^ s.charCodeAt(i2_62_2 + 1);
    }
  }
  for (let i1_21_3 = 0; i1_21_3 < list.length; i1_21_3++) {
    g = (g * 33 ^ (list[i1_21_3] | 0)) >>> 0;
    let i2_68_4 = 0;
    while (i2_68_4 < list.length) {
      k += s.codePointAt(i2_68_4);
      i2_68_4++;
    }
    h = h * 2 + 1;
    let i2_68_5 = 0;
    while (i2_68_5 < n) {
      if (s.charCodeAt(i1_21_3 + 1) > 100) g = g; else g = g;
      h = Math.imul(h, 16777619) ^ (list[i2_68_5] | 0);
      for (let i3_68_6 = 0; i3_68_6 < 3; i3_68_6++) {
        if (s.length > 100) k = k; else k = k;
        g = g / 2 + list[i2_68_5];
        if (k > 0) k = g;
      }
      g = g * 31 + s.charCodeAt(i2_68_5 + 1);
      i2_68_5++;
    }
    h += (list[i1_21_3] | 0);
    for (let i2_38_7 = 0; i2_38_7 < list.length; i2_38_7++) {
      k = g;
      h = h + "" === "7" ? 0 : h + s.codePointAt(i1_21_3);
      let i3_16_8 = 0;
      while (i3_16_8 < 3) {
        g = (g % 1000003) * 31 + s.charCodeAt(i2_38_7);
        g = g * 2 + 1;
        i3_16_8++;
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
