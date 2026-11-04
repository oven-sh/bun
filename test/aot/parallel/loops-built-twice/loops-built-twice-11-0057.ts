function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_56_1 = 0; i1_56_1 < list.length; i1_56_1++) {
    k = Math.imul(k, 16777619) ^ s.codePointAt(i1_56_1);
  }
  let i1_11_2 = 0;
  while (i1_11_2 < s.length) {
    k = (k ^ h) + list[i1_11_2];
    g = (g + s.charCodeAt(i1_11_2 + 1)) & 65535;
    h = h * 31 + (list[i1_11_2] | 0);
    i1_11_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
