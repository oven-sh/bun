function run(s, list, n) {
  let h = 0.5, g = 0, k = 1;
  for (let i1_65_1 = 0; i1_65_1 < 3; i1_65_1++) {
    k = (k + s.length) & 65535;
  }
  let i1_72_2 = 0;
  while (i1_72_2 < 3) {
    k = k * 2 + 1;
    i1_72_2++;
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
