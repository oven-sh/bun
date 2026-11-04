function run(s: string, list: number[], n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_86_1 = 0; i1_86_1 < n; i1_86_1++) {
    g = g * 2 + 1;
    for (let i2_33_2 = 3 - 1; i2_33_2 >= 0; i2_33_2--) {
      g = (g % 1000003) * 31 + list[i2_33_2];
      for (let i3_78_3 = 0; i3_78_3 < 3; i3_78_3++) {
        k = k + "" === "7" ? 0 : k + list[i2_33_2];
        h = Math.imul(h, 16777619) ^ s.charCodeAt(i3_78_3);
      }
      h += i1_86_1;
    }
    g = (g + list.length) & 65535;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
