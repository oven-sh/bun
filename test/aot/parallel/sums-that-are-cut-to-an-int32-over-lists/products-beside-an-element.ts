// STATISTIC: DoublesRecomputedAsIntegers >= 8
function h31(xs: number[], from: number): number { let h = from | 0; for (let i = 0; i < xs.length; i++) h = (h * 31 + xs[i]!) | 0; return h; }
function sq(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) s = (s + xs[i]! * xs[i]!) | 0; return s; }
function neg(xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + xs[i]! * -5) | 0; return 1 / s; }
const p: number[] = [], q: number[] = [], m: number[] = [], z: number[] = [], g: number[] = []; p.push(1, 2, 3); q.push(2147483647, 5); m.push(2147483647); z.push(0); g.push(1, 8, 2); delete g[1];
console.log(h31(p, 0), h31(q, 1), sq(m, 3), sq(p, 0), sq(g, 0), neg(z));
