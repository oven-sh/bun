function run(s, list, n) {
  let h = 0, g = 0, k = 1;
  for (let i1_94_1 = 0; i1_94_1 < 3; i1_94_1++) {
    if (h > 65535) h = 0;
  }
  for (let i1_42_2 = 0; i1_42_2 < n; i1_42_2++) {
    if (s.charCodeAt(i1_42_2) > 100) h = g; else g = h;
    k = k * 31 + i1_42_2;
    k = (k + i1_42_2) & 65535;
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
