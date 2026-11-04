function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_81_1 = 0; i1_81_1 < list.length; i1_81_1++) {
    h = h / 2 + i1_81_1;
    for (let i2_88_2 = 0; i2_88_2 < list.length; i2_88_2++) {
      k = k * 2 + 1;
    }
    h = -h + s.charCodeAt(i1_81_1);
  }
  for (let i1_20_3 = 0; i1_20_3 < 3; i1_20_3++) {
    h = (h % 1000003) * 31 + s.length;
    for (let i2_39_4 = 0; i2_39_4 < list.length; i2_39_4++) {
      k += s.length;
    }
    g = (g + s.codePointAt(i1_20_3)) & 65535;
    for (let i2_49_5 = 3 - 1; i2_49_5 >= 0; i2_49_5--) {
      k = k * 31 + s.length;
      for (let i3_68_6 = 0; i3_68_6 < n; i3_68_6++) {
        k = h - (list[i2_49_5] | 0);
      }
    }
    h = h - s.codePointAt(i1_20_3);
    for (let i2_41_7 = 0; i2_41_7 < 3; i2_41_7++) {
      g = g * 31 + i1_20_3;
      let i3_8_8 = 0;
      while (i3_8_8 < 3) {
        k = (k + list.length) & 65535;
        i3_8_8++;
      }
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
