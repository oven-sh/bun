// STATISTIC: ExactIntegersBehindNumbers >= 1
function f(xs: number[]): string { let s = 0, u = 0; for (let i = 0; i < xs.length; i++) { const t = s + xs[i]!; s = t | 0; u = t * 0.5; } return s + " " + u; }
function k(xs: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s = (s + xs[i & 3]!) | 0; return s; }
const a: number[] = [], b: number[] = [], c: number[] = []; a.push(1, 2); b.push(1, 2, 3); delete b[2]; c.push(1, 2, 3);
console.log(f(a), f(b), k(c, 3), k(c, 4), k(c, 9));
