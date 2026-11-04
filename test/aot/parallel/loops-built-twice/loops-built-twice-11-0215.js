function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_17_1 = 0; i1_17_1 < list.length; i1_17_1++) {
    h = Math.imul(h, 16777619) ^ s.codePointAt(i1_17_1);
    k = Math.imul(k, 16777619) ^ s.codePointAt(i1_17_1);
    g = g + "" === "7" ? 0 : g + s.codePointAt(i1_17_1);
    let i2_92_2 = 0;
    while (i2_92_2 < s.length) {
      h = (h * 31 + s.charCodeAt(i2_92_2)) | 0;
      let i3_33_3 = 0;
      while (i3_33_3 < 3) {
        h = (h << 5) - h + i3_33_3;
        i3_33_3++;
      }
      g = (g * 33 ^ s.charCodeAt(i2_92_2 + 1)) >>> 0;
      i2_92_2++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
