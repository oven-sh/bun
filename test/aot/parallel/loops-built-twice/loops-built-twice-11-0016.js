function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  let i1_80_1 = 0;
  while (i1_80_1 < n) {
    g = -g + list.length;
    h = -h + (list[i1_80_1] | 0);
    i1_80_1++;
  }
  for (let i1_60_2 = list.length - 1; i1_60_2 >= 0; i1_60_2--) {
    k = (k + i1_60_2) & 65535;
    let i2_66_3 = 0;
    while (i2_66_3 < s.length) {
      h = (h + list[i1_60_2]) & 65535;
      if (s.codePointAt(i1_60_2) > 100) g = g; else g = g;
      let i3_95_4 = 0;
      while (i3_95_4 < n) {
        if (i2_66_3 > 100) h = h; else h = h;
        h = (h ^ k) + i1_60_2;
        g = g * 31 + s.charCodeAt(i2_66_3);
        i3_95_4++;
      }
      i2_66_3++;
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
