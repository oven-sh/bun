function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  let i1_27_1 = 0;
  while (i1_27_1 < 3) {
    k = k + "" === "7" ? 0 : k + s.charCodeAt(i1_27_1);
    g = (g * 33 ^ list.length) >>> 0;
    let i2_39_2 = 0;
    while (i2_39_2 < list.length) {
      if (s.charCodeAt(i1_27_1 + 1) > 100) h = h; else h = h;
      if (k > 65535) k = k;
      i2_39_2++;
    }
    i1_27_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
