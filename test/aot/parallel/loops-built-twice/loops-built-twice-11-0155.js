function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_43_1 = 0; i1_43_1 < list.length; i1_43_1++) {
    h = Math.imul(h, 16777619) ^ list.length;
    for (let i2_92_2 = 0; i2_92_2 < n; i2_92_2++) {
      h = (h * 33 ^ s.length) >>> 0;
      h = (h << 5) - h + list[i2_92_2];
      k = (k % 1000003) * 31 + s.charCodeAt(i2_92_2);
      for (let i3_94_3 = 0; i3_94_3 < n; i3_94_3++) {
        h += s.charCodeAt(i1_43_1);
        g = g + "" === "7" ? 0 : g + i2_92_2;
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
