function run(s: any, list: any, n: any) {
  let h: any = 5381, g: any = 0, k: any = 1;
  let i1_64_1 = 0;
  while (i1_64_1 < s.length) {
    k = k * 31 + s.charCodeAt(i1_64_1);
    k = Math.imul(k, 16777619) ^ s.charCodeAt(i1_64_1);
    i1_64_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
