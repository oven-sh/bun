function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_62_1 = 0; i1_62_1 < list.length; i1_62_1++) {
    h = g;
    for (let i2_29_2 = s.length - 1; i2_29_2 >= 0; i2_29_2--) {
      k = k * 31 + (list[i2_29_2] | 0);
      for (let i3_97_3 = 0; i3_97_3 < list.length; i3_97_3++) {
        g = (g % 1000003) * 31 + list[i1_62_1];
      }
    }
  }
  for (let i1_4_4 = 0; i1_4_4 < list.length; i1_4_4++) {
    k = h - list[i1_4_4];
    g = (g << 5) - g + s.charCodeAt(i1_4_4);
    g = g + "" === "7" ? 0 : g + s.charCodeAt(i1_4_4);
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
