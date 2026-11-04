function run(s: string, list: number[], n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_86_1 = 0; i1_86_1 < list.length; i1_86_1++) {
    h += s.charCodeAt(i1_86_1 + 1);
    k = h;
    g = g - (list[i1_86_1] | 0);
    for (let i2_93_2 = 0; i2_93_2 < s.length; i2_93_2++) {
      k = k * 31 + list.length;
      for (let i3_79_3 = 0; i3_79_3 < s.length; i3_79_3++) {
        k = (k * 33 ^ list[i3_79_3]) >>> 0;
        k = (k * 33 ^ s.charCodeAt(i2_93_2)) >>> 0;
        if (h > 65535) h = 0.5;
      }
      k = Math.imul(k, 16777619) ^ list[i1_86_1];
    }
  }
  for (let i1_79_4 = s.length - 1; i1_79_4 >= 0; i1_79_4--) {
    h = Math.imul(h, 16777619) ^ s.codePointAt(i1_79_4);
    for (let i2_39_5 = 3 - 1; i2_39_5 >= 0; i2_39_5--) {
      h = (h << 5) - h + list.length;
      let i3_68_6 = 0;
      while (i3_68_6 < list.length) {
        k = k + "" === "7" ? 0 : k + (list[i2_39_5] | 0);
        i3_68_6++;
      }
    }
    k = -k + list[i1_79_4];
    k = k * 2 + 1;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
