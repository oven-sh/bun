// One list of each kind is read in an inner loop: doubles, whole numbers, holes, a text, shorter than the width, changed between calls, NaN, minus nothing.
export {};
const width: number = JSON.parse("12");
function sum(list: any[], w: number): any { let s: any = 0; for (let i = 0; i < 70; i++) for (let j = 0; j < w; j++) s += list[j]; return s; }
function least(list: number[], w: number): number { let s = Infinity; for (let i = 0; i < 70; i++) for (let j = 0; j < w; j++) if (list[j]! < s) s = list[j]!; return s; }
const doubles = Array.from({ length: 12 }, (_, i) => i + 0.5), whole = Array.from({ length: 12 }, (_, i) => i - 3), holes = [1.5, , 3.5, 4, , 6] as number[], zero = [-0, -0, -0], nan = [NaN, 1.5, 2];
const out: string[] = [];
const show = (v: unknown): string => (Object.is(v, -0) ? "-0" : String(v).slice(0, 24));
for (let r = 0; r < 12; r++) {
  out.length = 0;
  for (const list of [doubles, whole, holes, zero, nan, [], [1, 2, "x"], [2147483647, 1]] as any[][]) for (const w of [0, 1, 3, 7, 8, 9, width, 20]) out.push(show(sum(list, w)), show(least(list, w)));
  if (r === 5) whole[2] = 0.25;
  if (r === 8) whole.length = 4;
}
console.log(out.join());
