function run(s: any, list: any, n: any) {
  let h: any = 0, g: any = 0, k: any = 1;
  let i1_57_1 = 0;
  while (i1_57_1 < n) {
    if (s.codePointAt(i1_57_1) > 100) k = g; else g = k;
    i1_57_1++;
  }
  for (let i1_11_2 = 0; i1_11_2 < n; i1_11_2++) {
    g = g + "" === "7" ? 0 : g + s.codePointAt(i1_11_2);
    for (let i2_4_3 = 0; i2_4_3 < s.length; i2_4_3++) {
      g = (g ^ g) + s.charCodeAt(i1_11_2 + 1);
      g = g * 2 + 1;
      k = g;
      for (let i3_37_4 = 0; i3_37_4 < list.length; i3_37_4++) {
        h = h;
      }
    }
    g = Math.imul(g, 16777619) ^ s.codePointAt(i1_11_2);
    for (let i2_42_5 = s.length - 1; i2_42_5 >= 0; i2_42_5--) {
      if (s.charCodeAt(i1_11_2) > 100) h = k; else k = h;
    }
    k = (k + list[i1_11_2]) & 65535;
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
