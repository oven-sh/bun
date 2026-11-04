function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_33_1 = 0; i1_33_1 < n; i1_33_1++) {
    k = (k * 31 + (list[i1_33_1] | 0)) | 0;
    g += list.length;
    let i2_2_2 = 0;
    while (i2_2_2 < s.length) {
      h += s.length;
      i2_2_2++;
    }
    k = (k + s.charCodeAt(i1_33_1 + 1)) & 65535;
    for (let i2_17_3 = 0; i2_17_3 < list.length; i2_17_3++) {
      g = g + "" === "7" ? 0 : g + s.charCodeAt(i2_17_3);
    }
  }
  for (let i1_63_4 = list.length - 1; i1_63_4 >= 0; i1_63_4--) {
    k = -k + i1_63_4;
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
