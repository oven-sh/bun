// Elements of lists of numbers, with holes and without, held against undefined in a nest whose turns leave early.
function holes(c: any, n: number): any {
  let s = 0, i = 0;
  while (i < n) { for (let at = n - 1; at >= i; at--) { s += 1; if (c[i] !== undefined) break; } i++; }
  return s;
}
function missing(c: any, n: number): any {
  let s = 0;
  for (let i = 0; i < n; i++) for (let at = 0; at <= i; at++) { if (c[at] === undefined) s += 100; else if (c[at] == null) s += 1000; else s += c[at]; }
  return s;
}
function defaults(c: any, n: number): any { let s = 0; for (let i = 0; i < n; i++) s += (c[i] ?? 7) + (c[i] || 3); return s; }
const lists: any[] = [Array.from({ length: 24 }, (_, i) => i % 5), Array.from({ length: 24 }, (_, i) => i / 2), [0.5, , 2.5, NaN, , 1], [1, , 3], [1, undefined, 2.5, null], [], ["a", 1]];
for (let round = 0; round < 3; round++) for (const list of lists) console.log(holes(list, 8), missing(list, 8), defaults(list, 8));
