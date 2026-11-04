function run(s, list, n) {
  let h = 5381, g = 0, k = 1;
  let i1_75_1 = 0;
  while (i1_75_1 < s.length) {
    k = k / 2 + s.length;
    h = h * 2 + 1;
    for (let i2_72_2 = 0; i2_72_2 < s.length; i2_72_2++) {
      g = h;
      k += s.charCodeAt(i2_72_2);
    }
    k = k / 2 + s.charCodeAt(i1_75_1);
    for (let i2_24_3 = 0; i2_24_3 < n; i2_24_3++) {
      g = -g + s.charCodeAt(i1_75_1);
      for (let i3_38_4 = s.length - 1; i3_38_4 >= 0; i3_38_4--) {
        g = (g + list.length) & 65535;
        g = g;
        k = (k * 33 ^ (list[i3_38_4] | 0)) >>> 0;
      }
      k = (k * 33 ^ s.codePointAt(i2_24_3)) >>> 0;
      k = k * 2 + 1;
    }
    i1_75_1++;
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
