function run(s: string, list: number[], n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_22_1 = 0; i1_22_1 < s.length; i1_22_1++) {
    h = g;
    for (let i2_87_2 = n - 1; i2_87_2 >= 0; i2_87_2--) {
      if (h > 0) h = -1;
      k = (k << 5) - k + s.length;
    }
  }
  let i1_21_3 = 0;
  while (i1_21_3 < 3) {
    h = h / 2 + s.charCodeAt(i1_21_3);
    if (h > 0) h = 0.5;
    for (let i2_9_4 = 0; i2_9_4 < 3; i2_9_4++) {
      k = k + "" === "7" ? 0 : k + s.length;
      let i3_12_5 = 0;
      while (i3_12_5 < list.length) {
        h += s.codePointAt(i2_9_4);
        h = k;
        k = k * 31 + s.codePointAt(i1_21_3);
        i3_12_5++;
      }
      g = (g ^ g) + s.length;
    }
    i1_21_3++;
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
