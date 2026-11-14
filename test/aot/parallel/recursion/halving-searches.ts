// Searches by halves that return where the bounds have met, as loops and as functions that call themselves.
function again(a: number[], x: number, lo: number, hi: number): number { if (lo > hi) return -1; const m = (lo + hi) >> 1; if (a[m] === x) return m; return a[m]! < x ? again(a, x, m + 1, hi) : again(a, x, lo, m - 1); }
function swapped(a: number[], x: number, lo: number, hi: number): number { if (hi < lo) return ~lo; const m = (lo + hi) >>> 1; const held = a[m]!; if (held < x) return swapped(a, x, m + 1, hi); if (held > x) return swapped(a, x, lo, m - 1); return m; }
function first(a: number[], x: number, lo: number, hi: number): number { if (lo >= hi) return lo; const m = lo + ((hi - lo) >> 1); if (a[m]! < x) return first(a, x, m + 1, hi); return first(a, x, lo, m); }
function loop(a: number[], x: number): number { let lo = 0, hi = a.length - 1; for (;;) { if (lo > hi) return -lo - 1; const m = (lo + hi) >> 1; const held = a[m]!; if (held === x) return m; if (held < x) lo = m + 1; else hi = m - 1; } }
function broken(a: number[], x: number): number { let lo = 0, hi = a.length; while (true) { if (lo >= hi) break; const m = (lo + hi) >> 1; if (a[m]! <= x) lo = m + 1; else hi = m; } return lo; }
const lists: number[][] = [Array.from({ length: 40 }, (_, i) => i * 3), Array.from({ length: 25 }, (_, i) => i * 1.5), [], [7], JSON.parse("[1,4,9,16,25,36]"), [-5, -3, -0, 0, 4], [1, 2.5, 4, 2 ** 31, 2 ** 40], [5, 4, 3, 2, 1], Object.freeze([2, 4, 6, 8]) as number[]];
const holes: number[] = [1, 2, 3]; holes[20] = 400; lists.push(holes);
for (const a of lists) {
  const said: (number | string)[] = [];
  for (const x of [0, 3, 57, 4, 2.5, -3, 117, 9, NaN, 2 ** 31]) said.push(again(a, x, 0, a.length - 1), swapped(a, x, 0, a.length - 1), first(a, x, 0, a.length), loop(a, x), broken(a, x), again(a, x, -4, a.length + 3), first(a, x, 0.5, a.length), swapped(a, x, 0, 2 ** 31), "|");
  console.log(said.map(v => Object.is(v, -0) ? "-0" : String(v)).join(" "));
}
