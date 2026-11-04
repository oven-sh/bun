function run(s: any, list: any, n: any) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_74_1 = 0; i1_74_1 < s.length; i1_74_1++) {
    k = (k + s.charCodeAt(i1_74_1 + 1)) & 65535;
    if (list[i1_74_1] > 100) h = g; else g = h;
  }
  let i1_90_2 = 0;
  while (i1_90_2 < list.length) {
    h = h / 2 + (list[i1_90_2] | 0);
    g = (g + s.charCodeAt(i1_90_2 + 1)) & 65535;
    k = k * 31 + list[i1_90_2];
    for (let i2_29_3 = 0; i2_29_3 < list.length; i2_29_3++) {
      g = g;
      k = k + "" === "7" ? 0 : k + (list[i1_90_2] | 0);
    }
    i1_90_2++;
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
