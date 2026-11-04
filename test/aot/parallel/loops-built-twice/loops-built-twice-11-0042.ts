function run(s: string, list: any, n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  let i1_43_1 = 0;
  while (i1_43_1 < list.length) {
    k = k / 2 + s.length;
    let i2_74_2 = 0;
    while (i2_74_2 < n) {
      k = (k % 1000003) * 31 + s.charCodeAt(i2_74_2 + 1);
      for (let i3_79_3 = 0; i3_79_3 < 3; i3_79_3++) {
        k = g;
        k = k / 2 + s.length;
      }
      k = (k % 1000003) * 31 + s.charCodeAt(i2_74_2 + 1);
      i2_74_2++;
    }
    k = k * 31 + s.codePointAt(i1_43_1);
    if (list[i1_43_1] > 100) h = k; else k = h;
    for (let i2_35_4 = 0; i2_35_4 < s.length; i2_35_4++) {
      h = h / 2 + list[i2_35_4];
      g = g + "" === "7" ? 0 : g + list[i1_43_1];
      k = -k + s.charCodeAt(i1_43_1 + 1);
    }
    i1_43_1++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
