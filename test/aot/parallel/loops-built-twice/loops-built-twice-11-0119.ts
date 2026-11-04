function run(s: string, list: any, n: number) {
  let h: any = 0, g: any = 0, k: any = 1;
  for (let i1_47_1 = 0; i1_47_1 < s.length; i1_47_1++) {
    g = (g * 33 ^ s.length) >>> 0;
    k = k / 2 + s.codePointAt(i1_47_1);
    for (let i2_52_2 = 0; i2_52_2 < n; i2_52_2++) {
      k = -k + list[i1_47_1];
      k = (k ^ g) + s.length;
      g = g * 31 + list[i1_47_1];
      for (let i3_5_3 = 0; i3_5_3 < s.length; i3_5_3++) {
        h += s.charCodeAt(i3_5_3);
      }
    }
    k = Math.imul(k, 16777619) ^ s.charCodeAt(i1_47_1);
    for (let i2_29_4 = 0; i2_29_4 < list.length; i2_29_4++) {
      k = Math.imul(k, 16777619) ^ s.charCodeAt(i1_47_1);
      for (let i3_60_5 = 0; i3_60_5 < list.length; i3_60_5++) {
        k = k;
        g = (g ^ k) + s.charCodeAt(i2_29_4);
      }
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
