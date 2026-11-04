function run(s: any, list: any, n: any) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_87_1 = 0; i1_87_1 < s.length; i1_87_1++) {
    k = k / 2 + s.charCodeAt(i1_87_1 + 1);
    for (let i2_81_2 = 0; i2_81_2 < n; i2_81_2++) {
      g = -g + s.charCodeAt(i2_81_2 + 1);
    }
    h = -h + s.codePointAt(i1_87_1);
    k = k / 2 + list[i1_87_1];
    for (let i2_45_3 = 0; i2_45_3 < list.length; i2_45_3++) {
      h = (h * 33 ^ s.charCodeAt(i2_45_3)) >>> 0;
      let i3_66_4 = 0;
      while (i3_66_4 < s.length) {
        k += s.charCodeAt(i1_87_1 + 1);
        g = (g ^ g) + i2_45_3;
        h = k - list[i3_66_4];
        i3_66_4++;
      }
      k = (k * 31 + s.charCodeAt(i1_87_1 + 1)) | 0;
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
