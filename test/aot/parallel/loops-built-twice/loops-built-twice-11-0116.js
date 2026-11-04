function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_17_1 = 0; i1_17_1 < list.length; i1_17_1++) {
    h = h * 2 + 1;
    for (let i2_92_2 = 0; i2_92_2 < list.length; i2_92_2++) {
      if (s.charCodeAt(i1_17_1) > 100) h = h; else h = h;
      for (let i3_55_3 = 0; i3_55_3 < 3; i3_55_3++) {
        h = Math.imul(h, 16777619) ^ s.length;
        h = (h ^ k) + (list[i2_92_2] | 0);
      }
      g = (g % 1000003) * 31 + list[i1_17_1];
      for (let i3_7_4 = 0; i3_7_4 < n; i3_7_4++) {
        g = (g % 1000003) * 31 + s.codePointAt(i3_7_4);
        g = (g ^ g) + s.charCodeAt(i2_92_2 + 1);
        h = h * 31 + list[i2_92_2];
      }
      h = h + "" === "7" ? 0 : h + list[i2_92_2];
    }
    g = g / 2 + s.charCodeAt(i1_17_1);
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
