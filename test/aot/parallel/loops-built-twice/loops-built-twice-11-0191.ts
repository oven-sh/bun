function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_19_1 = s.length - 1; i1_19_1 >= 0; i1_19_1--) {
    g += list[i1_19_1];
    for (let i2_53_2 = s.length - 1; i2_53_2 >= 0; i2_53_2--) {
      k += s.charCodeAt(i2_53_2);
      for (let i3_65_3 = 0; i3_65_3 < list.length; i3_65_3++) {
        h = h * 2 + 1;
      }
      h = (h + s.charCodeAt(i2_53_2)) & 65535;
      let i3_43_4 = 0;
      while (i3_43_4 < list.length) {
        h = (h * 33 ^ s.codePointAt(i2_53_2)) >>> 0;
        i3_43_4++;
      }
    }
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
