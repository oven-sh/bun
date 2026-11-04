function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_49_1 = 0;
  while (i1_49_1 < list.length) {
    h = h + "" === "7" ? 0 : h + (list[i1_49_1] | 0);
    let i2_74_2 = 0;
    while (i2_74_2 < n) {
      k = (k * 31 + s.charCodeAt(i1_49_1)) | 0;
      for (let i3_83_3 = s.length - 1; i3_83_3 >= 0; i3_83_3--) {
        h = (h * 33 ^ s.length) >>> 0;
      }
      k = (k + s.length) & 65535;
      g = (g + list[i1_49_1]) & 65535;
      i2_74_2++;
    }
    i1_49_1++;
  }
  for (let i1_99_4 = 0; i1_99_4 < 3; i1_99_4++) {
    k = -k + s.codePointAt(i1_99_4);
    for (let i2_94_5 = 0; i2_94_5 < list.length; i2_94_5++) {
      h = (h ^ g) + s.charCodeAt(i2_94_5);
    }
    k = k / 2 + i1_99_4;
    g = (g % 1000003) * 31 + list.length;
    for (let i2_84_6 = 0; i2_84_6 < s.length; i2_84_6++) {
      k += s.length;
      h = h - (list[i2_84_6] | 0);
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
