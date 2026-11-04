function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_13_1 = 0;
  while (i1_13_1 < 3) {
    k = k * 31 + s.codePointAt(i1_13_1);
    h = (h + s.charCodeAt(i1_13_1 + 1)) & 65535;
    i1_13_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
