function run(s: string, list: any, n: number) {
  let h: any = 0.5, g: any = 0, k: any = 1;
  for (let i1_51_1 = 0; i1_51_1 < 3; i1_51_1++) {
    h = (h ^ h) + list[i1_51_1];
    g = (g + s.codePointAt(i1_51_1)) & 65535;
    k = (k % 1000003) * 31 + s.codePointAt(i1_51_1);
  }
  for (let i1_0_2 = 0; i1_0_2 < list.length; i1_0_2++) {
    g = Math.imul(g, 16777619) ^ (list[i1_0_2] | 0);
    h = (h << 5) - h + list[i1_0_2];
    for (let i2_35_3 = 0; i2_35_3 < list.length; i2_35_3++) {
      h = h / 2 + s.charCodeAt(i1_0_2);
      h = (h * 33 ^ (list[i1_0_2] | 0)) >>> 0;
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
