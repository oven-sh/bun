function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_41_1 = 0; i1_41_1 < s.length; i1_41_1++) {
    k = k * 31 + s.codePointAt(i1_41_1);
    let i2_57_2 = 0;
    while (i2_57_2 < s.length) {
      g = k;
      k = -k + list.length;
      i2_57_2++;
    }
    k += s.charCodeAt(i1_41_1);
    h = Math.imul(h, 16777619) ^ list[i1_41_1];
    let i2_56_3 = 0;
    while (i2_56_3 < list.length) {
      g = (g ^ k) + s.codePointAt(i1_41_1);
      for (let i3_40_4 = 0; i3_40_4 < list.length; i3_40_4++) {
        g = h - list[i1_41_1];
        g = -g + s.charCodeAt(i2_56_3);
      }
      h = h * 2 + 1;
      i2_56_3++;
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
