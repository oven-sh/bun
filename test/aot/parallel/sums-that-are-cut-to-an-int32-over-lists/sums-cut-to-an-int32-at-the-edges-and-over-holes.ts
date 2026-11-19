// STATISTIC: DoublesRecomputedAsIntegers >= 1
function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) s = (s + xs[i]!) | 0; return s; }
const a: number[] = [], w: number[] = [], h: number[] = [], t: number[] = []; a.push(2147483647, 1, -2147483648); h.push(1, 2, 3, 4); for (let i = 0; i < 20; i++) { w.push(2147483647); t.push(i); }
delete h[1]; delete t[9];
console.log(run(a, 1), run(a, -1), run(w, 0), run(h, 0), run(t, 0), run([], 7));
