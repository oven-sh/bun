function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_45_1 = 0; i1_45_1 < 3; i1_45_1++) {
    k = (k ^ k) + s.charCodeAt(i1_45_1);
  }
  for (let i1_9_2 = s.length - 1; i1_9_2 >= 0; i1_9_2--) {
    k = k * 31 + list[i1_9_2];
    g = h;
    h = Math.imul(h, 16777619) ^ s.charCodeAt(i1_9_2);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
globalThis.kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]]) console.log(run(s, list, n));
