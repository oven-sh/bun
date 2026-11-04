function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  let i1_58_1 = 0;
  while (i1_58_1 < s.length) {
    k = Math.imul(k, 16777619) ^ list.length;
    k = h;
    g = g * 2 + 1;
    for (let i2_12_2 = 0; i2_12_2 < n; i2_12_2++) {
      k = (k * 33 ^ s.charCodeAt(i2_12_2)) >>> 0;
      k = (k * 31 + s.length) | 0;
      k = k / 2 + list.length;
      let i3_44_3 = 0;
      while (i3_44_3 < list.length) {
        k = -k + s.charCodeAt(i2_12_2);
        i3_44_3++;
      }
    }
    i1_58_1++;
  }
  let i1_95_4 = 0;
  while (i1_95_4 < s.length) {
    k = (k + s.codePointAt(i1_95_4)) & 65535;
    k = k * 31 + s.charCodeAt(i1_95_4);
    if (list[i1_95_4] > 100) g = h; else h = g;
    i1_95_4++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
