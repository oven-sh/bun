function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  let i1_15_1 = 0;
  while (i1_15_1 < 3) {
    g = (g * 33 ^ list[i1_15_1]) >>> 0;
    let i2_85_2 = 0;
    while (i2_85_2 < s.length) {
      k = k / 2 + list.length;
      h = h + "" === "7" ? 0 : h + i2_85_2;
      for (let i3_99_3 = 0; i3_99_3 < 3; i3_99_3++) {
        k = -k + s.charCodeAt(i3_99_3);
        h = h * 2 + 1;
        h = h;
      }
      i2_85_2++;
    }
    i1_15_1++;
  }
  for (let i1_77_4 = s.length - 1; i1_77_4 >= 0; i1_77_4--) {
    k = k + "" === "7" ? 0 : k + list[i1_77_4];
    h = Math.imul(h, 16777619) ^ i1_77_4;
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
