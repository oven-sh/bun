function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_34_1 = 0; i1_34_1 < n; i1_34_1++) {
    h = (h + s.codePointAt(i1_34_1)) & 65535;
    let i2_33_2 = 0;
    while (i2_33_2 < s.length) {
      g = -g + s.charCodeAt(i2_33_2);
      let i3_47_3 = 0;
      while (i3_47_3 < list.length) {
        k = (k << 5) - k + s.codePointAt(i1_34_1);
        h = (h << 5) - h + list[i3_47_3];
        i3_47_3++;
      }
      k = (k * 33 ^ s.charCodeAt(i1_34_1 + 1)) >>> 0;
      for (let i3_4_4 = 0; i3_4_4 < n; i3_4_4++) {
        k = (k ^ g) + s.length;
      }
      i2_33_2++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
