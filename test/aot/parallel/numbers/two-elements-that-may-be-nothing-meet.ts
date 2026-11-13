// STATISTIC: ArithmeticOnMarkers >= 1
function f(a: number[], b: number[], n: number): number { let s = 0; for (let i = 0; i < n; i++) s += a[i & 7]! + b[i & 7]!; return s; }
const a = [1, 2, 3, 4, 5, 6, 7, 8.5], b = [1, 2, 3];
console.log(f(a, a, 16), f(a, b, 16));
export {};
