// STATISTIC: DoublesRecomputedAsIntegers >= 1
function f(xs: number[]): string { let a = 0, b = 0, c = 0; for (let i = 0; i < xs.length; i++) { a = (a + xs[i]!) >>> 0; b = (b - xs[i]!) & 255; c = (c + xs[i]!) << 1; } return [a, b, c].join(); }
const l: number[] = [], k: number[] = []; l.push(-1, 5); k.push(-1, 5, 9, 7); delete k[2];
console.log(f(l), f(k), f(k.slice(0, 3)));
