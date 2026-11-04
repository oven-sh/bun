function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_36_1 = 0;
  while (i1_36_1 < s.length) {
    if ((list[i1_36_1] | 0) > 100) g = h; else h = g;
    i1_36_1++;
  }
  for (let i1_49_2 = 0; i1_49_2 < s.length; i1_49_2++) {
    k = (k % 1000003) * 31 + s.charCodeAt(i1_49_2);
    for (let i2_77_3 = list.length - 1; i2_77_3 >= 0; i2_77_3--) {
      h = (h + list[i1_49_2]) & 65535;
    }
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
