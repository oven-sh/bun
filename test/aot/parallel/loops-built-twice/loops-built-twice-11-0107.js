function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_22_1 = 0; i1_22_1 < s.length; i1_22_1++) {
    k = (k % 1000003) * 31 + list[i1_22_1];
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
