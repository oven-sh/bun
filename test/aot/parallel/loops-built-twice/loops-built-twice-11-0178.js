function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  let i1_19_1 = 0;
  while (i1_19_1 < s.length) {
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_19_1);
    for (let i2_5_2 = 0; i2_5_2 < n; i2_5_2++) {
      h = h * 31 + list[i1_19_1];
      g = Math.imul(g, 16777619) ^ list[i2_5_2];
    }
    g = (g * 33 ^ list.length) >>> 0;
    i1_19_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
