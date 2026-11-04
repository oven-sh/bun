function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_68_1 = 0; i1_68_1 < 3; i1_68_1++) {
    k = h - s.charCodeAt(i1_68_1 + 1);
  }
  for (let i1_48_2 = 0; i1_48_2 < list.length; i1_48_2++) {
    g = (g % 1000003) * 31 + list[i1_48_2];
    h = (h * 33 ^ list[i1_48_2]) >>> 0;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
