function run(s: string, list: any, n: number) {
  let h: any = 1, g: any = 0, k: any = 1;
  for (let i1_86_1 = 0; i1_86_1 < n; i1_86_1++) {
    k = (k ^ g) + list[i1_86_1];
    for (let i2_19_2 = 0; i2_19_2 < s.length; i2_19_2++) {
      if (s.charCodeAt(i1_86_1 + 1) > 100) g = h; else h = g;
      for (let i3_58_3 = 0; i3_58_3 < s.length; i3_58_3++) {
        if (g > 1e15) g = 0;
        h = -h + s.length;
      }
    }
    g = -g + s.charCodeAt(i1_86_1 + 1);
    for (let i2_29_4 = 0; i2_29_4 < list.length; i2_29_4++) {
      g = Math.imul(g, 16777619) ^ s.charCodeAt(i2_29_4 + 1);
      k = g;
      g = -g + i2_29_4;
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
