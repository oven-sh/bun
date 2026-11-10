// STATISTIC: DoublesRecomputedAsIntegers >= 1
function run(xs: any[], n: number, v: any): number { let s = 0; for (let i = 0; i < n; i++) { s = (s + xs[i]) | 0; if (i === 3) xs.push(v); } return s; }
function g(xs: number[]): number { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + xs[i]!) | 0; return s; }
console.log(run([1, 2, 3, 4], 5, 0.5), run([1, 2, 3, 4], 6, 0.5), run([1, 2, 3, 4], 5, "x"), g([1.5, 2.5]), g([-0, NaN, 2]), g([2147483648, -0.9]), g([1, undefined as any, 4]));
