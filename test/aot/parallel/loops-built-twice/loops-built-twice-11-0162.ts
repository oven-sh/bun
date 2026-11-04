function run(s: string, list: number[], n: number) {
  let h: any = 5381, g: any = 0, k: any = 1;
  for (let i1_42_1 = 0; i1_42_1 < 3; i1_42_1++) {
    k = k + "" === "7" ? 0 : k + (list[i1_42_1] | 0);
  }
  for (let i1_66_2 = 0; i1_66_2 < s.length; i1_66_2++) {
    if (list[i1_66_2] > 100) k = g; else g = k;
    h = Math.imul(h, 16777619) ^ s.charCodeAt(i1_66_2 + 1);
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
