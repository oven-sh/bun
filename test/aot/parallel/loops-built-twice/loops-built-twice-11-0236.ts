function run(s: any, list: any, n: any) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_38_1 = 0; i1_38_1 < n; i1_38_1++) {
    g = (g << 5) - g + list[i1_38_1];
    for (let i2_70_2 = 0; i2_70_2 < 3; i2_70_2++) {
      k = (k + s.charCodeAt(i2_70_2)) & 65535;
    }
    h = (h ^ g) + list[i1_38_1];
    k = h;
  }
  let i1_39_3 = 0;
  while (i1_39_3 < n) {
    g += s.codePointAt(i1_39_3);
    let i2_13_4 = 0;
    while (i2_13_4 < list.length) {
      h = (h + i1_39_3) & 65535;
      i2_13_4++;
    }
    h = k;
    h += s.charCodeAt(i1_39_3 + 1);
    i1_39_3++;
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
