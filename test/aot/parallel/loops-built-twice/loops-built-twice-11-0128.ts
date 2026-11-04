function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_33_1 = 0; i1_33_1 < s.length; i1_33_1++) {
    g += s.charCodeAt(i1_33_1);
    for (let i2_47_2 = 0; i2_47_2 < list.length; i2_47_2++) {
      h = (h << 5) - h + s.charCodeAt(i2_47_2);
      k = (k * 31 + list[i2_47_2]) | 0;
      for (let i3_9_3 = list.length - 1; i3_9_3 >= 0; i3_9_3--) {
        h = -h + s.length;
      }
    }
    g = g * 2 + 1;
  }
  for (let i1_41_4 = 0; i1_41_4 < 3; i1_41_4++) {
    k = Math.imul(k, 16777619) ^ (list[i1_41_4] | 0);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
