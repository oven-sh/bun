function run(s: string, list: number[], n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_91_1 = 0; i1_91_1 < list.length; i1_91_1++) {
    g = (g * 31 + s.charCodeAt(i1_91_1)) | 0;
    g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_91_1);
  }
  for (let i1_6_2 = s.length - 1; i1_6_2 >= 0; i1_6_2--) {
    if (s.charCodeAt(i1_6_2) > 100) k = h; else h = k;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
