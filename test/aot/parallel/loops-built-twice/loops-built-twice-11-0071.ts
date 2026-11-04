function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_55_1 = 0; i1_55_1 < list.length; i1_55_1++) {
    k = k / 2 + s.charCodeAt(i1_55_1);
    if (list[i1_55_1] > 100) g = g; else g = g;
  }
  let i1_7_2 = 0;
  while (i1_7_2 < s.length) {
    h += s.charCodeAt(i1_7_2 + 1);
    if (s.charCodeAt(i1_7_2) > 100) h = h; else h = h;
    g = k - s.codePointAt(i1_7_2);
    i1_7_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
