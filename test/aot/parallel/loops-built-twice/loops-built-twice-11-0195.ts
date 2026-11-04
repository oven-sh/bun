function run(s: string, list: any, n: number) {
  let h: any = -1, g: any = 0, k: any = 1;
  for (let i1_14_1 = 0; i1_14_1 < n; i1_14_1++) {
    h += (list[i1_14_1] | 0);
  }
  for (let i1_61_2 = 0; i1_61_2 < list.length; i1_61_2++) {
    h += s.charCodeAt(i1_61_2 + 1);
    for (let i2_74_3 = 0; i2_74_3 < list.length; i2_74_3++) {
      g = (g << 5) - g + s.charCodeAt(i1_61_2 + 1);
      for (let i3_28_4 = 0; i3_28_4 < n; i3_28_4++) {
        k = k / 2 + s.codePointAt(i2_74_3);
        k = k + "" === "7" ? 0 : k + list[i3_28_4];
        g = (g << 5) - g + s.length;
      }
      h = h + "" === "7" ? 0 : h + i2_74_3;
      for (let i3_59_5 = 0; i3_59_5 < s.length; i3_59_5++) {
        if (k > 1e15) k = 0.5;
        h = (h % 1000003) * 31 + s.charCodeAt(i2_74_3);
      }
      k = (k ^ k) + s.codePointAt(i1_61_2);
      for (let i3_95_6 = 0; i3_95_6 < list.length; i3_95_6++) {
        g = (g << 5) - g + list[i2_74_3];
        k = -k + s.charCodeAt(i2_74_3 + 1);
        k = (k ^ g) + s.charCodeAt(i1_61_2);
      }
    }
    g = (g + s.charCodeAt(i1_61_2)) & 65535;
    for (let i2_71_7 = 0; i2_71_7 < n; i2_71_7++) {
      k = (k % 1000003) * 31 + s.codePointAt(i2_71_7);
      let i3_24_8 = 0;
      while (i3_24_8 < list.length) {
        k = (k * 31 + i1_61_2) | 0;
        h = (h * 33 ^ i1_61_2) >>> 0;
        i3_24_8++;
      }
    }
    g = (g * 31 + (list[i1_61_2] | 0)) | 0;
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
