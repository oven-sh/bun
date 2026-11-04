function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_90_1 = 0; i1_90_1 < list.length; i1_90_1++) {
    k = (k << 5) - k + i1_90_1;
    h = (h * 31 + s.length) | 0;
  }
  for (let i1_94_2 = 0; i1_94_2 < n; i1_94_2++) {
    g = (g + (list[i1_94_2] | 0)) & 65535;
    for (let i2_6_3 = 0; i2_6_3 < list.length; i2_6_3++) {
      k = g;
    }
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
