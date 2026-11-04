function run(s, list, n) {
  let h = 1, g = 0, k = 1;
  for (let i1_65_1 = 0; i1_65_1 < s.length; i1_65_1++) {
    k = (k + s.codePointAt(i1_65_1)) & 65535;
    k = (k + s.codePointAt(i1_65_1)) & 65535;
  }
  for (let i1_68_2 = list.length - 1; i1_68_2 >= 0; i1_68_2--) {
    g = g / 2 + i1_68_2;
    for (let i2_12_3 = list.length - 1; i2_12_3 >= 0; i2_12_3--) {
      k = (k ^ k) + s.charCodeAt(i1_68_2);
      g = Math.imul(g, 16777619) ^ list[i1_68_2];
    }
    h += list.length;
    for (let i2_20_4 = 0; i2_20_4 < n; i2_20_4++) {
      g = (g + list.length) & 65535;
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
