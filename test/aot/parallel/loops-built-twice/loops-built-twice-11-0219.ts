function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_20_1 = 0; i1_20_1 < list.length; i1_20_1++) {
    g = g / 2 + s.codePointAt(i1_20_1);
  }
  for (let i1_80_2 = 0; i1_80_2 < 3; i1_80_2++) {
    g = (g * 33 ^ s.codePointAt(i1_80_2)) >>> 0;
    h = h + "" === "7" ? 0 : h + s.length;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
