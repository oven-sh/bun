function run(s: string, list: number[], n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_4_1 = list.length - 1; i1_4_1 >= 0; i1_4_1--) {
    h = (h * 31 + list[i1_4_1]) | 0;
    for (let i2_44_2 = 0; i2_44_2 < s.length; i2_44_2++) {
      if (s.codePointAt(i2_44_2) > 100) g = h; else h = g;
      if (s.codePointAt(i2_44_2) > 100) h = k; else k = h;
      h = (h << 5) - h + list[i1_4_1];
      for (let i3_27_3 = 0; i3_27_3 < n; i3_27_3++) {
        k = (k * 33 ^ list[i3_27_3]) >>> 0;
      }
    }
    k = (k ^ k) + s.charCodeAt(i1_4_1);
    k = -k + list.length;
  }
  let i1_87_4 = 0;
  while (i1_87_4 < 3) {
    if (g > 0) g = 0.5;
    let i2_78_5 = 0;
    while (i2_78_5 < list.length) {
      k = (k * 33 ^ s.length) >>> 0;
      h = (h % 1000003) * 31 + s.charCodeAt(i1_87_4);
      let i3_89_6 = 0;
      while (i3_89_6 < 3) {
        h = (h << 5) - h + s.charCodeAt(i1_87_4);
        g = g + "" === "7" ? 0 : g + s.length;
        i3_89_6++;
      }
      i2_78_5++;
    }
    h += s.codePointAt(i1_87_4);
    for (let i2_33_7 = 0; i2_33_7 < s.length; i2_33_7++) {
      if (s.charCodeAt(i2_33_7 + 1) > 100) g = g; else g = g;
    }
    i1_87_4++;
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
