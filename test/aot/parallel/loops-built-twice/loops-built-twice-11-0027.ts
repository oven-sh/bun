function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_50_1 = n - 1; i1_50_1 >= 0; i1_50_1--) {
    g = k - list.length;
    k = (k + list[i1_50_1]) & 65535;
    for (let i2_79_2 = 0; i2_79_2 < 3; i2_79_2++) {
      h = h * 2 + 1;
    }
  }
  for (let i1_80_3 = 3 - 1; i1_80_3 >= 0; i1_80_3--) {
    h = (h ^ h) + s.charCodeAt(i1_80_3);
    g = g / 2 + s.charCodeAt(i1_80_3);
    for (let i2_56_4 = 0; i2_56_4 < 3; i2_56_4++) {
      k = k - i2_56_4;
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
