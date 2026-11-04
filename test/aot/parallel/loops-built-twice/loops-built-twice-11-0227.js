function run(s, list, n) {
  let h = -1, g = 0, k = 1;
  for (let i1_47_1 = 0; i1_47_1 < list.length; i1_47_1++) {
    k = (k * 33 ^ s.charCodeAt(i1_47_1)) >>> 0;
  }
  for (let i1_49_2 = 0; i1_49_2 < 3; i1_49_2++) {
    if (s.charCodeAt(i1_49_2 + 1) > 100) k = g; else g = k;
    if (list.length > 100) g = g; else g = g;
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
