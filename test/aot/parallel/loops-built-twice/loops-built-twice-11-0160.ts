function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_28_1 = 0; i1_28_1 < 3; i1_28_1++) {
    k = k * 31 + list.length;
    k = (k % 1000003) * 31 + s.charCodeAt(i1_28_1);
  }
  let i1_12_2 = 0;
  while (i1_12_2 < 3) {
    h = -h + list[i1_12_2];
    for (let i2_5_3 = s.length - 1; i2_5_3 >= 0; i2_5_3--) {
      h = (h + list[i1_12_2]) & 65535;
      for (let i3_39_4 = 0; i3_39_4 < s.length; i3_39_4++) {
        g = g * 31 + list[i1_12_2];
        h = h / 2 + list.length;
        h = -h + list.length;
      }
      h = (h * 33 ^ i1_12_2) >>> 0;
      g = (g % 1000003) * 31 + i2_5_3;
    }
    k = (k ^ g) + list[i1_12_2];
    k = k / 2 + s.charCodeAt(i1_12_2);
    i1_12_2++;
  }
  return [h, g, k].map(x => Object.is(x, -0) ? "-0" : String(x)).join(" ");
}
(globalThis as any).kept = run;
for (const [s, list, n] of [["abcdefghij", [1, 2, 3, 4], 3], ["", [], 0], ["\uffff\uffff\uffffz", [2147483647, -2147483648, 0.5], 2], ["a\ud83d\ude00b", [1e15, -0, NaN, 4294967295, 7], 4]] as any[]) console.log(run(s, list, n));
