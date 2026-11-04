function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  let i1_68_1 = 0;
  while (i1_68_1 < s.length) {
    g = (g << 5) - g + s.charCodeAt(i1_68_1);
    for (let i2_89_2 = s.length - 1; i2_89_2 >= 0; i2_89_2--) {
      h = h / 2 + s.length;
      k = k * 31 + s.charCodeAt(i2_89_2);
      for (let i3_13_3 = 0; i3_13_3 < s.length; i3_13_3++) {
        h = (h % 1000003) * 31 + s.charCodeAt(i3_13_3 + 1);
        h = h;
      }
      k = k;
    }
    if (h > 0) h = 0;
    h = h * 2 + 1;
    i1_68_1++;
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
