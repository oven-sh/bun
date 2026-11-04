function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_57_1 = s.length - 1; i1_57_1 >= 0; i1_57_1--) {
    h = k;
    k = k / 2 + list[i1_57_1];
    g = -g + s.codePointAt(i1_57_1);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
try {
  console.log((globalThis as any).kept([104, 105], "hi", 2));
} catch (error) {
  console.log((error as Error).name);
}
