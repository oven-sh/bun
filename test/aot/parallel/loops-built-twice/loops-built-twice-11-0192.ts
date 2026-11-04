function run(s: string, list: number[], n: number) {
  let h: any = 2166136261, g: any = 0, k: any = 1;
  for (let i1_68_1 = 0; i1_68_1 < list.length; i1_68_1++) {
    k = (k + list[i1_68_1]) & 65535;
  }
  for (let i1_76_2 = 0; i1_76_2 < n; i1_76_2++) {
    h = Math.imul(h, 16777619) ^ list[i1_76_2];
    for (let i2_22_3 = 0; i2_22_3 < s.length; i2_22_3++) {
      g = Math.imul(g, 16777619) ^ s.charCodeAt(i1_76_2 + 1);
      k = (k * 33 ^ list[i2_22_3]) >>> 0;
    }
    k = (k * 33 ^ i1_76_2) >>> 0;
    for (let i2_16_4 = 0; i2_16_4 < s.length; i2_16_4++) {
      k = (k + list[i1_76_2]) & 65535;
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
