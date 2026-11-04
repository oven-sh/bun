function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_67_1 = 0; i1_67_1 < s.length; i1_67_1++) {
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_67_1 + 1);
    for (let i2_6_2 = 0; i2_6_2 < list.length; i2_6_2++) {
      k = -k + list[i2_6_2];
      g = (g % 1000003) * 31 + s.charCodeAt(i2_6_2);
      for (let i3_20_3 = list.length - 1; i3_20_3 >= 0; i3_20_3--) {
        k = (k << 5) - k + s.charCodeAt(i1_67_1);
        k = k * 2 + 1;
      }
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
