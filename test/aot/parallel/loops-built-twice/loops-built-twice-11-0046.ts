function run(s: string, list: any, n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_55_1 = list.length - 1; i1_55_1 >= 0; i1_55_1--) {
    k = k - i1_55_1;
    for (let i2_7_2 = 0; i2_7_2 < n; i2_7_2++) {
      k = (k * 33 ^ list.length) >>> 0;
    }
    h = h * 31 + list[i1_55_1];
    let i2_59_3 = 0;
    while (i2_59_3 < 3) {
      g = -g + s.codePointAt(i1_55_1);
      h = (h * 33 ^ s.codePointAt(i2_59_3)) >>> 0;
      i2_59_3++;
    }
    h += s.charCodeAt(i1_55_1);
    for (let i2_31_4 = 3 - 1; i2_31_4 >= 0; i2_31_4--) {
      k = -k + list.length;
      k = k * 31 + list[i2_31_4];
      if (h > 2147483647) h = g;
    }
  }
  for (let i1_79_5 = s.length - 1; i1_79_5 >= 0; i1_79_5--) {
    g = g + "" === "7" ? 0 : g + s.charCodeAt(i1_79_5 + 1);
    if (list[i1_79_5] > 100) k = h; else h = k;
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
