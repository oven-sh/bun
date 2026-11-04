function run(s: any, list: any, n: any) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_13_1 = 0; i1_13_1 < list.length; i1_13_1++) {
    h = -h + s.charCodeAt(i1_13_1);
  }
  for (let i1_81_2 = 0; i1_81_2 < n; i1_81_2++) {
    h = g;
    let i2_48_3 = 0;
    while (i2_48_3 < list.length) {
      if (h > 65535) h = 0;
      for (let i3_8_4 = 0; i3_8_4 < s.length; i3_8_4++) {
        h = (h % 1000003) * 31 + i2_48_3;
      }
      i2_48_3++;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
